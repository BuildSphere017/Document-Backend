import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { prisma } from "../config/prisma.js"
import { env } from "../config/env.js"
import { ApiError } from "../utils/ApiError.js"
import { activityService } from "./activity.service.js"
import type { LoginInput } from "../validation/auth.validation.js"

const publicUser = (u: {
  id: string
  fullName: string
  username: string
  email: string | null
  role: string
  department: string | null
  status: string
  avatarUrl: string | null
  storageUsed: bigint
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}) => ({
  id: u.id,
  fullName: u.fullName,
  username: u.username,
  email: u.email,
  role: u.role,
  department: u.department,
  status: u.status,
  avatarUrl: u.avatarUrl,
  storageUsed: Number(u.storageUsed),
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
})

const sign = (userId: string, role: string) =>
  jwt.sign(
    { sub: userId, role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn } as jwt.SignOptions,
  )

const timed = async <T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const start = Date.now()

  try {
    return await fn()
  } finally {
    console.log(`[Auth] ${name}: ${Date.now() - start}ms`)
  }
}

export const authService = {
  async login(input: LoginInput, ip?: string) {
    const totalStart = Date.now()

    const user = await timed("user lookup", () =>
      prisma.user.findFirst({
        where: {
          username: input.username,
          deletedAt: null,
        },
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          passwordHash: true,
          role: true,
          department: true,
          status: true,
          avatarUrl: true,
          storageUsed: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    )

    if (!user) {
      throw ApiError.unauthorized("Invalid username or password")
    }

    if (user.status === "DISABLED") {
      throw ApiError.forbidden("This account has been disabled")
    }

    const valid = await timed(
      "bcrypt",
      () => bcrypt.compare(input.password, user.passwordHash),
    )

    if (!valid) {
      throw ApiError.unauthorized("Invalid username or password")
    }

    void prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch((err) => {
        console.error("[auth] lastLoginAt update failed", err)
      })

    void activityService.log({
      action: "LOGIN",
      actorName: user.fullName,
      userId: user.id,
      ip,
    })

    const accessToken = sign(user.id, user.role)

    console.log(`[Auth] login total: ${Date.now() - totalStart}ms`)

    return {
      accessToken,
      user: publicUser(user),
    }
  },

  async me(userId: string) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
    })

    if (!user) {
      throw ApiError.notFound("User not found")
    }

    return publicUser(user)
  },
}