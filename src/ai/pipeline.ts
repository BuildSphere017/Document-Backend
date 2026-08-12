import { prisma } from "../config/prisma.js"
import { getAIProvider } from "./ai.provider.js"
import { extractText, chunkText } from "./extract.js"
import { storage } from "../storage/supabase.storage.js"
import { env } from "../config/env.js"
import type { FileType } from "@prisma/client"

/** Convert a JS number[] into a pgvector literal: [0.1,0.2,...] */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * Full post-upload AI processing for a document:
 *   download → extract text → summarize + keywords → chunk → embed → store vectors.
 * Runs in the background; flips document status PROCESSING → READY / FAILED.
 * Never throws into the request path.
 */
export async function processDocument(documentId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) return

  // If no AI key configured, skip gracefully and mark READY (manual search still works).
  const provider = env.ai.provider
  const hasKey =
    provider === "ollama" ||
    (provider === "gemini" && env.ai.geminiApiKey) ||
    (provider === "openai" && env.ai.openaiApiKey)
  if (!hasKey) {
    await prisma.document.update({ where: { id: documentId }, data: { status: "READY" } })
    return
  }

  try {
    await prisma.document.update({ where: { id: documentId }, data: { status: "PROCESSING" } })

    const buffer = await storage.download(doc.storagePath)
    const text = await extractText(buffer, doc.fileType as FileType, doc.mimeType)

    if (!text.trim()) {
      // Nothing to embed (e.g. a video or an image with no text) — still searchable by metadata.
      await prisma.document.update({ where: { id: documentId }, data: { status: "READY", extractedText: "" } })
      return
    }

    const ai = getAIProvider()

    // Summary + keywords (best-effort)
    let summary: string | undefined
    try {
      const s = await ai.chat(
        "You summarize business documents in 2 concise sentences. Output plain text only.",
        `Summarize this document:\n\n${text.slice(0, 6000)}`
      )
      summary = s.trim().slice(0, 800)
    } catch { /* non-fatal */ }

    // Chunk + embed
    const chunks = chunkText(text)
    const batchSize = 16
    let index = 0

    // Clear any previous chunks (re-processing)
    await prisma.$executeRaw`DELETE FROM "DocumentChunk" WHERE "documentId" = ${documentId}`

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)
      const embeddings = await ai.embed(batch)
      for (let j = 0; j < batch.length; j++) {
        const emb = embeddings[j]
        if (!emb?.length) { index++; continue }
        const id = `chk_${documentId}_${index}`
        const vec = toVectorLiteral(emb)
        // Raw insert because Prisma can't write the Unsupported(vector) column
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" ("id","documentId","content","chunkIndex","embedding","createdAt")
           VALUES ($1,$2,$3,$4,$5::vector,now())`,
          id, documentId, batch[j], index, vec
        )
        index++
      }
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "READY", summary, extractedText: text.slice(0, 20000) },
    })
    await prisma.notification.create({
      data: {
        userId: doc.uploadedById,
        title: "Document ready",
        body: `"${doc.title}" has been processed and is now searchable with AI.`,
        type: "info",
        link: "/documents",
      },
    }).catch(() => {})
    console.log(`[pipeline] processed ${documentId}: ${index} chunks embedded`)
  } catch (err) {
    console.error(`[pipeline] failed for ${documentId}:`, (err as Error).message)
    await prisma.document.update({ where: { id: documentId }, data: { status: "FAILED" } }).catch(() => {})
  }
}
