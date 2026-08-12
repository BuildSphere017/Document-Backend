import { z } from "zod"

export const aiSearchSchema = z.object({
  query: z.string().min(1, "Enter a search query"),
})

export const aiChatSchema = z.object({
  question: z.string().min(1, "Enter a question"),
  documentId: z.string().optional(),
})

export type AiSearchInput = z.infer<typeof aiSearchSchema>
export type AiChatInput = z.infer<typeof aiChatSchema>
