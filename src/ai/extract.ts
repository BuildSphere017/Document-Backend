import type { FileType } from "@prisma/client"
import { getAIProvider } from "./ai.provider.js"
import { env } from "../config/env.js"

/**
 * Extract plain text from a file buffer based on its type.
 * - PDF / DOCX / XLSX → parsed directly
 * - Images → Gemini Vision OCR (accurate, handles Hindi/logos/scans); falls back to Tesseract
 * Everything is best-effort — failure returns "" so upload never breaks.
 */
export async function extractText(buffer: Buffer, fileType: FileType, mimeType: string): Promise<string> {
  try {
    if (fileType === "PDF") {
      const pdfParse = (await import("pdf-parse")).default
      const data = await pdfParse(buffer)
      return data.text ?? ""
    }
    if (fileType === "DOCX") {
      const mammoth = await import("mammoth")
      const { value } = await mammoth.extractRawText({ buffer })
      return value ?? ""
    }
    if (fileType === "XLSX") {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(buffer, { type: "buffer" })
      return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n")
    }
    if (fileType === "IMAGE" || mimeType.startsWith("image/")) {
      return await extractFromImage(buffer, mimeType)
    }
  } catch (err) {
    console.error(`[extract] failed for ${fileType}:`, (err as Error).message)
  }
  return ""
}

/** OCR an image: prefer Gemini Vision (if a key is set), else Tesseract.js. */
async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const provider = getAIProvider()

  // 1) Gemini Vision (accurate, handles Hindi/logos/blurry scans)
  if (env.ai.provider === "gemini" && env.ai.geminiApiKey && provider.vision) {
    try {
      const base64 = buffer.toString("base64")
      const text = await provider.vision(base64, mimeType || "image/png")
      if (text?.trim()) {
        console.log(`[extract:image] Gemini Vision read ${text.trim().length} chars`)
        return text
      }
      console.log("[extract:image] Gemini Vision returned no text, trying Tesseract")
    } catch (err) {
      console.error("[extract:image] Gemini Vision failed:", (err as Error).message)
    }
  }

  // 2) Fallback → Tesseract.js
  try {
    const { createWorker } = await import("tesseract.js")
    const worker = await createWorker("eng")
    try {
      const { data } = await worker.recognize(buffer)
      return data.text ?? ""
    } finally {
      await worker.terminate()
    }
  } catch (err) {
    console.error("[extract:image] Tesseract failed:", (err as Error).message)
    return ""
  }
}

/** Split text into overlapping chunks (~1000 chars, 150 overlap) for embedding. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length)
    chunks.push(clean.slice(start, end))
    if (end === clean.length) break
    start = end - overlap
  }
  return chunks
}
