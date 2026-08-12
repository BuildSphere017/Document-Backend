import multer from "multer"
import { env } from "../config/env.js"
import { ApiError } from "../utils/ApiError.js"
import { ALLOWED_MIME_TYPES } from "../utils/fileType.js"

/** In-memory storage — files are streamed to Supabase, never written to local disk. */
const storage = multer.memoryStorage()

export const upload = multer({
  storage,
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) return cb(null, true)
    cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`))
  },
})
