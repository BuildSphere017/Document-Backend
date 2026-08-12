import bcrypt from "bcryptjs"
import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"
import { env } from "../config/env.js"

export const settingsService = {
  async getProfile(userId: string) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, username: true, email: true, role: true, department: true, createdAt: true, lastLoginAt: true },
    })
    if (!u) throw ApiError.notFound("User not found")
    return u
  },
  async updateProfile(userId: string, data: { fullName?: string; email?: string; department?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data: { fullName: data.fullName, email: data.email || undefined, department: data.department },
      select: { id: true, fullName: true, username: true, email: true, role: true, department: true },
    })
  },
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const u = await prisma.user.findUnique({ where: { id: userId } })
    if (!u) throw ApiError.notFound("User not found")
    const ok = await bcrypt.compare(currentPassword, u.passwordHash)
    if (!ok) throw ApiError.badRequest("Current password is incorrect")
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    return { success: true }
  },
  async systemInfo() {
    return {
      aiProvider: env.ai.provider,
      storageBucket: env.supabase.bucket,
      storageConfigured: env.supabase.enabled,
      maxFileSizeMb: env.maxFileSizeMb,
    }
  },
}
