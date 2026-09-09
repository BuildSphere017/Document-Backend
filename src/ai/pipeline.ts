import { prisma } from "../config/prisma.js"
import { getAIProvider } from "./ai.provider.js"
import { extractText, chunkText } from "./extract.js"
import { storage } from "../storage/supabase.storage.js"
import { env } from "../config/env.js"
import type { FileType } from "@prisma/client"

/**
 * Convert a JS number[] into a pgvector literal.
 *
 * Example:
 * [0.1, 0.2, 0.3]
 * becomes:
 * "[0.1,0.2,0.3]"
 */
function toVectorLiteral(
  embedding: number[]
): string {
  return `[${embedding.join(",")}]`
}

/**
 * Maximum amount of document text used for
 * generating the AI summary.
 *
 * IMPORTANT:
 * This does NOT limit document extraction.
 *
 * The complete document is still:
 * - extracted
 * - stored
 * - chunked
 * - embedded
 */
const SUMMARY_MAX_CHARS = 12000

/**
 * Number of chunks sent to the embedding
 * provider in one request.
 */
const EMBEDDING_BATCH_SIZE = 16

/**
 * Safety limit.
 *
 * Prevents an accidentally huge document from
 * creating an unlimited number of chunks.
 */
const MAX_CHUNKS_PER_DOCUMENT = 10000

/**
 * Full document AI processing pipeline:
 *
 * Original file
 *      ↓
 * Storage download
 *      ↓
 * Complete text extraction
 *      ↓
 * AI summary
 *      ↓
 * Complete text chunking
 *      ↓
 * Embeddings
 *      ↓
 * pgvector
 *      ↓
 * COMPLETE extracted text stored
 *      ↓
 * READY
 *
 * This function runs in the background after upload.
 */
export async function processDocument(
  documentId: string
): Promise<void> {
  const doc =
    await prisma.document.findUnique({
      where: {
        id: documentId,
      },
    })

  if (!doc) {
    console.error(
      `[pipeline] document not found: ${documentId}`
    )
    return
  }

  /**
   * Check whether an AI provider is configured.
   */
  const provider =
    env.ai.provider

  const hasAI =
    provider === "ollama" ||
    (
      provider === "gemini" &&
      Boolean(
        env.ai.geminiApiKey
      )
    ) ||
    (
      provider === "openai" &&
      Boolean(
        env.ai.openaiApiKey
      )
    )

  /**
   * If AI is not configured, don't break
   * document uploading.
   *
   * The document can still be found using
   * normal metadata search.
   */
  if (!hasAI) {
    console.log(
      `[pipeline] AI not configured for ${documentId}; marking READY`
    )

    await prisma.document.update({
      where: {
        id: documentId,
      },
      data: {
        status: "READY",
      },
    })

    return
  }

  try {
    /**
     * ----------------------------------------
     * STEP 1 — PROCESSING
     * ----------------------------------------
     */
    await prisma.document.update({
      where: {
        id: documentId,
      },
      data: {
        status: "PROCESSING",
      },
    })

    console.log(
      `[pipeline] starting ${documentId}: "${doc.title}"`
    )

    /**
     * ----------------------------------------
     * STEP 2 — DOWNLOAD ORIGINAL FILE
     * ----------------------------------------
     */
    const buffer =
      await storage.download(
        doc.storagePath
      )

    console.log(
      `[pipeline] downloaded ${documentId}: ${buffer.length} bytes`
    )

    /**
     * ----------------------------------------
     * STEP 3 — COMPLETE TEXT EXTRACTION
     * ----------------------------------------
     *
     * extractText() now supports:
     *
     * - normal PDFs
     * - scanned PDFs
     * - images
     * - DOCX
     * - XLSX
     */
    const extracted =
      await extractText(
        buffer,
        doc.fileType as FileType,
        doc.mimeType
      )

    const text =
      extracted.trim()

    console.log(
      `[pipeline] extracted ${documentId}: ${text.length} characters`
    )

    /**
     * ----------------------------------------
     * STEP 4 — EMPTY DOCUMENT
     * ----------------------------------------
     *
     * If no text was extracted, don't try
     * embedding an empty document.
     */
    if (!text) {
      await prisma.$executeRaw`
        DELETE FROM "DocumentChunk"
        WHERE "documentId" = ${documentId}
      `

      await prisma.document.update({
        where: {
          id: documentId,
        },
        data: {
          status: "READY",

          /**
           * Explicitly store empty text.
           */
          extractedText: "",

          summary: null,
        },
      })

      console.log(
        `[pipeline] ${documentId}: no extractable text`
      )

      await createReadyNotification(
        doc.uploadedById,
        doc.title
      )

      return
    }

    /**
     * Get configured AI provider.
     */
    const ai =
      getAIProvider()

    /**
     * ----------------------------------------
     * STEP 5 — GENERATE SUMMARY
     * ----------------------------------------
     *
     * Summary is optional.
     *
     * If Gemini/Ollama/OpenAI summary generation
     * fails, the document will STILL be indexed.
     */
    let summary:
      | string
      | undefined

    try {
      const summarySource =
        text.slice(
          0,
          SUMMARY_MAX_CHARS
        )

      const generated =
        await ai.chat(
          `
You are a document summarization assistant for a company Document Management System.

Rules:
- Use ONLY the supplied document content.
- Never invent facts.
- Do not guess missing information.
- Do not add external information.
- Return plain text only.
- Keep the summary concise.
- Summarize the actual document, not the user's request.
- Mention important document purpose, subject, product/company name, dates, test information, specifications or conclusions when they are present.
          `.trim(),
          `
DOCUMENT CONTENT:

${summarySource}
          `.trim()
        )

      if (
        generated?.trim()
      ) {
        summary =
          generated
            .trim()
            .slice(
              0,
              1200
            )
      }

      console.log(
        `[pipeline] summary generated for ${documentId}`
      )
    } catch (err) {
      console.error(
        `[pipeline] summary failed for ${documentId}:`,
        (err as Error).message
      )

      /**
       * Non-fatal.
       *
       * The actual extracted text and vectors
       * remain the source of truth.
       */
    }

    /**
     * ----------------------------------------
     * STEP 6 — COMPLETE DOCUMENT CHUNKING
     * ----------------------------------------
     *
     * IMPORTANT:
     *
     * We pass the COMPLETE extracted text.
     *
     * There is NO:
     *
     * text.slice(0, 20000)
     *
     * here.
     */
    const chunks =
      chunkText(
        text
      )

    console.log(
      `[pipeline] ${documentId}: ${chunks.length} chunks created`
    )

    if (
      chunks.length >
      MAX_CHUNKS_PER_DOCUMENT
    ) {
      throw new Error(
        `Document generated ${chunks.length} chunks, exceeding safety limit of ${MAX_CHUNKS_PER_DOCUMENT}`
      )
    }

    /**
     * ----------------------------------------
     * STEP 7 — DELETE OLD CHUNKS
     * ----------------------------------------
     *
     * Critical for re-processing.
     *
     * Suppose a document was processed yesterday
     * and today we process it again.
     *
     * Old vectors must not remain.
     */
    await prisma.$executeRaw`
      DELETE FROM "DocumentChunk"
      WHERE "documentId" = ${documentId}
    `

    /**
     * ----------------------------------------
     * STEP 8 — EMBEDDINGS
     * ----------------------------------------
     */
    let embeddedCount = 0
    let skippedCount = 0

    for (
      let start = 0;
      start < chunks.length;
      start += EMBEDDING_BATCH_SIZE
    ) {
      const batch =
        chunks.slice(
          start,
          start +
            EMBEDDING_BATCH_SIZE
        )

      console.log(
        `[pipeline] ${documentId}: embedding chunks ${start + 1}-${Math.min(
          start + batch.length,
          chunks.length
        )}/${chunks.length}`
      )

      let embeddings:
        number[][] = []

      try {
        embeddings =
          await ai.embed(
            batch
          )
      } catch (err) {
        console.error(
          `[pipeline] embedding batch failed for ${documentId}:`,
          (err as Error).message
        )

        /**
         * Do not crash the entire processing job
         * because one embedding batch failed.
         */
        skippedCount +=
          batch.length

        continue
      }

      /**
       * Store every returned embedding.
       */
      for (
        let j = 0;
        j < batch.length;
        j++
      ) {
        const chunk =
          batch[j]

        const embedding =
          embeddings?.[j]

        const chunkIndex =
          start + j

        /**
         * Missing embedding.
         */
        if (
          !embedding ||
          embedding.length === 0
        ) {
          skippedCount++

          console.warn(
            `[pipeline] missing embedding for ${documentId}, chunk ${chunkIndex}`
          )

          continue
        }

        /**
         * Stable chunk ID.
         *
         * This also makes debugging easier.
         */
        const chunkId =
          `chk_${documentId}_${chunkIndex}`

        const vector =
          toVectorLiteral(
            embedding
          )

        /**
         * Prisma cannot directly insert the
         * Unsupported(vector) field, therefore
         * raw SQL is used.
         */
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "DocumentChunk"
            (
              "id",
              "documentId",
              "content",
              "chunkIndex",
              "embedding",
              "createdAt"
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5::vector,
              now()
            )
          `,
          chunkId,
          documentId,
          chunk,
          chunkIndex,
          vector
        )

        embeddedCount++
      }
    }

    /**
     * ----------------------------------------
     * STEP 9 — SAVE COMPLETE DOCUMENT TEXT
     * ----------------------------------------
     *
     * THIS IS THE IMPORTANT FIX.
     *
     * Previous:
     *
     * extractedText: text.slice(0, 20000)
     *
     * That discarded everything after 20,000
     * characters.
     *
     * Now:
     *
     * extractedText: text
     *
     * The complete extracted document remains
     * available to the DMS.
     */
    await prisma.document.update({
      where: {
        id: documentId,
      },
      data: {
        status: "READY",

        /**
         * COMPLETE TEXT.
         */
        extractedText:
          text,

        summary,
      },
    })

    /**
     * ----------------------------------------
     * STEP 10 — NOTIFICATION
     * ----------------------------------------
     */
    await createReadyNotification(
      doc.uploadedById,
      doc.title
    )

    console.log(
      `[pipeline] processed ${documentId}: ${embeddedCount} chunks embedded, ${skippedCount} skipped, ${text.length} characters stored`
    )
  } catch (err) {
    /**
     * ----------------------------------------
     * FAILURE
     * ----------------------------------------
     */
    console.error(
      `[pipeline] failed for ${documentId}:`,
      (err as Error).message
    )

    await prisma.document
      .update({
        where: {
          id: documentId,
        },
        data: {
          status: "FAILED",
        },
      })
      .catch(
        () => {}
      )
  }
}

/**
 * Create "Document ready" notification.
 *
 * Notification failure should never make the
 * document processing fail.
 */
async function createReadyNotification(
  userId: string,
  title: string
): Promise<void> {
  await prisma.notification
    .create({
      data: {
        userId,
        title: "Document ready",
        body: `"${title}" has been processed and is now searchable with AI.`,
        type: "info",
        link: "/documents",
      },
    })
    .catch(
      (err) => {
        console.error(
          "[pipeline] notification failed:",
          (err as Error).message
        )
      }
    )
}