import type { FileType } from "@prisma/client"

const MAP: Record<string, FileType> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/msword": "DOCX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPT",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-excel": "XLSX",
  "application/zip": "ZIP",
  "application/x-zip-compressed": "ZIP",
}

export function resolveFileType(mimeType: string): FileType {
  if (MAP[mimeType]) return MAP[mimeType]
  if (mimeType.startsWith("image/")) return "IMAGE"
  if (mimeType.startsWith("video/")) return "VIDEO"
  return "OTHER"
}

export const ALLOWED_MIME_TYPES = [
  ...Object.keys(MAP),
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
]
