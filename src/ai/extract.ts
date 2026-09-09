import type { FileType } from "@prisma/client"
import { getAIProvider } from "./ai.provider.js"
import { env } from "../config/env.js"

/**
 * Extract text from supported document types.
 *
 * PDF:
 *   1. Try normal PDF text extraction.
 *   2. If little/no text is found, try OCR page-by-page.
 *
 * DOCX:
 *   Extract normal document text.
 *
 * XLSX:
 *   Extract every worksheet.
 *
 * IMAGE:
 *   Gemini Vision first, Tesseract fallback.
 */
export async function extractText(
  buffer: Buffer,
  fileType: FileType,
  mimeType: string
): Promise<string> {
  try {
    if (fileType === "PDF") {
      return await extractFromPdf(buffer)
    }

    if (fileType === "DOCX") {
      return await extractFromDocx(buffer)
    }

    if (fileType === "XLSX") {
      return await extractFromXlsx(buffer)
    }

    if (
      fileType === "IMAGE" ||
      mimeType.toLowerCase().startsWith("image/")
    ) {
      return await extractFromImage(
        buffer,
        mimeType
      )
    }
  } catch (err) {
    console.error(
      `[extract] failed for ${fileType}:`,
      (err as Error).message
    )
  }

  return ""
}

/**
 * Extract PDF text.
 *
 * Normal PDFs are handled by pdf-parse.
 * Scanned PDFs are sent through OCR when
 * normal extraction produces little/no text.
 */
async function extractFromPdf(
  buffer: Buffer
): Promise<string> {
  let parsedText = ""

  try {
    const pdfParse =
      (await import("pdf-parse")).default

    const data =
      await pdfParse(buffer)

    parsedText =
      cleanExtractedText(
        data.text ?? ""
      )

    console.log(
      `[extract:pdf] normal extraction: ${parsedText.length} chars, ${data.numpages ?? "?"} pages`
    )
  } catch (err) {
    console.error(
      "[extract:pdf] pdf-parse failed:",
      (err as Error).message
    )
  }

  /*
   * Normal text-based PDF.
   */
  if (
    hasUsefulText(parsedText)
  ) {
    return parsedText
  }

  /*
   * Probably a scanned/image PDF.
   */
  console.log(
    "[extract:pdf] little/no text detected - trying PDF OCR"
  )

  try {
    const ocrText =
      await extractPdfWithOcr(
        buffer
      )

    if (
      hasUsefulText(ocrText)
    ) {
      console.log(
        `[extract:pdf] OCR extracted ${ocrText.length} chars`
      )

      return ocrText
    }
  } catch (err) {
    console.error(
      "[extract:pdf] OCR failed:",
      (err as Error).message
    )
  }

  /*
   * Keep whatever normal extraction found.
   */
  return parsedText
}

/**
 * Check whether extracted text is actually useful.
 */
function hasUsefulText(
  text: string
): boolean {
  const clean =
    cleanExtractedText(text)

  if (
    clean.length < 80
  ) {
    return false
  }

  const meaningful =
    clean.replace(
      /[^\p{L}\p{N}]/gu,
      ""
    )

  return meaningful.length >= 50
}

/**
 * OCR a scanned PDF page-by-page.
 *
 * Each page is rendered to PNG and then
 * passed through the existing image OCR.
 */
async function extractPdfWithOcr(
  buffer: Buffer
): Promise<string> {
  const pdfjsLib =
    await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )

  const loadingTask =
    pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    })

  const pdf =
    await loadingTask.promise

  console.log(
    `[extract:pdf-ocr] rendering ${pdf.numPages} pages`
  )

  const pageTexts: string[] = []

  /*
   * Load canvas once instead of once per page.
   */
  const canvasModule =
    await import("canvas")

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    try {
      const page =
        await pdf.getPage(
          pageNumber
        )

      /*
       * Higher scale gives OCR more detail.
       */
      const scale = 2

      const viewport =
        page.getViewport({
          scale,
        })

      const canvas =
        canvasModule.createCanvas(
          Math.ceil(
            viewport.width
          ),
          Math.ceil(
            viewport.height
          )
        )

      const context =
        canvas.getContext("2d")

      /*
       * pdfjs-dist version currently
       * installed in your project requires
       * the "canvas" property as well.
       */
      const renderContext: any = {
        canvasContext: context,
        viewport,
        canvas,
      }

      await page.render(
        renderContext
      ).promise

      const imageBuffer =
        canvas.toBuffer(
          "image/png"
        )

      const pageText =
        await extractFromImage(
          imageBuffer,
          "image/png"
        )

      const cleanPageText =
        cleanExtractedText(
          pageText
        )

      if (
        cleanPageText
      ) {
        pageTexts.push(
          `Page ${pageNumber}\n${cleanPageText}`
        )
      }

      console.log(
        `[extract:pdf-ocr] page ${pageNumber}/${pdf.numPages}: ${cleanPageText.length} chars`
      )
    } catch (err) {
      console.error(
        `[extract:pdf-ocr] page ${pageNumber} failed:`,
        (err as Error).message
      )
    }
  }

  return cleanExtractedText(
    pageTexts.join(
      "\n\n"
    )
  )
}

/**
 * Extract text from DOCX.
 */
async function extractFromDocx(
  buffer: Buffer
): Promise<string> {
  const mammoth =
    await import("mammoth")

  const result =
    await mammoth.extractRawText({
      buffer,
    })

  return cleanExtractedText(
    result.value ?? ""
  )
}

/**
 * Extract text from XLSX.
 *
 * Every worksheet is included.
 */
async function extractFromXlsx(
  buffer: Buffer
): Promise<string> {
  const XLSX =
    await import("xlsx")

  const workbook =
    XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    })

  const sheets: string[] = []

  for (
    const sheetName of
    workbook.SheetNames
  ) {
    const sheet =
      workbook.Sheets[
        sheetName
      ]

    if (!sheet) {
      continue
    }

    const csv =
      XLSX.utils.sheet_to_csv(
        sheet,
        {
          blankrows: false,
        }
      )

    if (
      csv.trim()
    ) {
      sheets.push(
        `Sheet: ${sheetName}\n${csv}`
      )
    }
  }

  return cleanExtractedText(
    sheets.join(
      "\n\n"
    )
  )
}

/**
 * Extract text from an image.
 *
 * Gemini Vision is preferred.
 * Tesseract is the fallback.
 */
async function extractFromImage(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const provider =
    getAIProvider()

  /*
   * 1. Gemini Vision
   */
  if (
    env.ai.provider ===
      "gemini" &&
    env.ai.geminiApiKey &&
    provider.vision
  ) {
    try {
      const base64 =
        buffer.toString(
          "base64"
        )

      const text =
        await provider.vision(
          base64,
          mimeType ||
            "image/png"
        )

      if (
        text?.trim()
      ) {
        const clean =
          cleanExtractedText(
            text
          )

        console.log(
          `[extract:image] Gemini Vision read ${clean.length} chars`
        )

        return clean
      }

      console.log(
        "[extract:image] Gemini Vision returned no text - trying Tesseract"
      )
    } catch (err) {
      console.error(
        "[extract:image] Gemini Vision failed:",
        (err as Error).message
      )
    }
  }

  /*
   * 2. Tesseract fallback
   */
  try {
    const {
      createWorker,
    } = await import(
      "tesseract.js"
    )

    const worker =
      await createWorker(
        "eng"
      )

    try {
      const result =
        await worker.recognize(
          buffer
        )

      const text =
        cleanExtractedText(
          result.data.text ??
            ""
        )

      console.log(
        `[extract:image] Tesseract read ${text.length} chars`
      )

      return text
    } finally {
      await worker.terminate()
    }
  } catch (err) {
    console.error(
      "[extract:image] Tesseract failed:",
      (err as Error).message
    )

    return ""
  }
}

/**
 * Clean extracted text.
 *
 * We preserve useful line breaks because
 * they can help with:
 *
 * - reports
 * - certificates
 * - tables
 * - addresses
 * - lists
 */
function cleanExtractedText(
  text: string
): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n[ \t]+/g,
      "\n"
    )
    .replace(
      /[ \t]+\n/g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim()
}

/**
 * Split extracted text into overlapping
 * chunks for embedding.
 *
 * Default:
 *   1000 characters
 *   150 character overlap
 */
export function chunkText(
  text: string,
  size = 1000,
  overlap = 150
): string[] {
  const clean =
    cleanExtractedText(
      text
    )

  if (!clean) {
    return []
  }

  if (
    size <= 0 ||
    overlap < 0 ||
    overlap >= size
  ) {
    throw new Error(
      "Invalid chunk size/overlap"
    )
  }

  const chunks: string[] = []

  let start = 0

  while (
    start < clean.length
  ) {
    let end = Math.min(
      start + size,
      clean.length
    )

    /*
     * Try to finish around a natural
     * sentence/line/word boundary.
     */
    if (
      end < clean.length
    ) {
      const newline =
        clean.lastIndexOf(
          "\n",
          end
        )

      const sentence =
        Math.max(
          clean.lastIndexOf(
            ". ",
            end
          ),
          clean.lastIndexOf(
            "? ",
            end
          ),
          clean.lastIndexOf(
            "! ",
            end
          )
        )

      const space =
        clean.lastIndexOf(
          " ",
          end
        )

      const boundary =
        Math.max(
          newline,
          sentence,
          space
        )

      if (
        boundary >
        start +
          Math.floor(
            size * 0.65
          )
      ) {
        end = boundary
      }
    }

    const chunk =
      clean
        .slice(
          start,
          end
        )
        .trim()

    if (chunk) {
      chunks.push(
        chunk
      )
    }

    if (
      end >=
      clean.length
    ) {
      break
    }

    start = Math.max(
      0,
      end - overlap
    )
  }

  return chunks
}