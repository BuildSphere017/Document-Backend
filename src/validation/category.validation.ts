import { z } from "zod"

export const createCategorySchema = z.object({
  name: z.string().min(2, "Category name is required"),
  color: z.string().regex(/^#([0-9a-fA-F]{6})$/, "Color must be a hex value").optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
})

export const updateCategorySchema = z.object({
  name: z.string().min(2).optional(),
  color: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
