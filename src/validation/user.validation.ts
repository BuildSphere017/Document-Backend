import { z } from "zod"

export const createUserSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  username: z.string().min(3, "Username must be at least 3 characters").max(50, "Max 50 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")).transform((v) => v || undefined),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]).default("SALES"),
  department: z.string().optional(),
  departmentId: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
})

export const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]).optional(),
  department: z.string().optional(),
  departmentId: z.string().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  categoryIds: z.array(z.string()).optional(),
})

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>