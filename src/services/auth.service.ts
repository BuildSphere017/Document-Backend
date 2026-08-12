import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { prisma } from "../config/prisma.js"
import { env } from "../config/env.js"
import { ApiError } from "../utils/ApiError.js"
import { activityService } from "./activity.service.js"
import type { LoginInput } from "../validation/auth.validation.js"

function sign(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions)
}

const publicUser = (u: {
  id: string; fullName: string; username: string; email: string | null; role: string
  department: string | null; status: string; avatarUrl: string | null
  storageUsed: bigint; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date
}) => ({
  id: u.id, fullName: u.fullName, username: u.username, email: u.email, role: u.role,
  department: u.department, status: u.status, avatarUrl: u.avatarUrl,
  storageUsed: Number(u.storageUsed), lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt, updatedAt: u.updatedAt,
})

export const authService = {
  async login(input: LoginInput, ip?: string) {
    const user = await prisma.user.findFirst({
      where: { username: input.username, deletedAt: null },
    })
    if (!user) throw ApiError.unauthorized("Invalid username or password")
    if (user.status === "DISABLED") throw ApiError.forbidden("This account has been disabled")

    const ok = await bcrypt.compare(input.password, user.passwordHash)
    if (!ok) throw ApiError.unauthorized("Invalid username or password")

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await activityService.log({
      action: "LOGIN", actorName: user.fullName, userId: user.id, ip,
    })

    return { accessToken: sign(user.id, user.role), user: publicUser(user) }
  },

  async me(userId: string) {
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw ApiError.notFound("User not found")
    return publicUser(user)
  },
}
