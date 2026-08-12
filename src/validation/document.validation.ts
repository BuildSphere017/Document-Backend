import { z } from "zod"

export const uploadDocumentSchema = z.object({
  title: z.string().min(1, "Title is required"),
  keyword: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  categoryId: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  description: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
})

export const listDocumentsSchema = z.object({
  q: z.string().optional(),
  categoryId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
})

export const createShareSchema = z.object({
  password: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  expiresInHours: z.coerce.number().int().min(1).max(8760).optional(),
  maxViews: z.coerce.number().int().min(1).optional(),
})

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>
export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>
