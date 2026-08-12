import bcrypt from "bcryptjs"
import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"
import type { CreateUserInput, UpdateUserInput } from "../validation/user.validation.js"

const userSelect = {
  id: true, fullName: true, username: true, email: true, role: true,
  department: true, departmentId: true, status: true, avatarUrl: true, storageUsed: true,
  lastLoginAt: true, createdAt: true, updatedAt: true,
  dept: { select: { id: true, name: true, color: true } },
  permissions: { select: { categoryId: true, canView: true, canUpload: true, canDelete: true } },
  _count: { select: { documents: true } },
} as const

export const userService = {
  async list() {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: userSelect,
      orderBy: { createdAt: "desc" },
    })
    return users
  },

  async create(input: CreateUserInput) {
    const exists = await prisma.user.findUnique({ where: { username: input.username } })
    if (exists) throw ApiError.conflict("Username is already taken")

    const passwordHash = await bcrypt.hash(input.password, 12)

    return prisma.user.create({
      data: {
        fullName: input.fullName,
        username: input.username,
        email: input.email,
        passwordHash,
        role: input.role,
        department: input.department,
        departmentId: (input as any).departmentId || undefined,
        permissions: {
          create: input.categoryIds.map((categoryId) => ({ categoryId, canView: true })),
        },
      },
      select: userSelect,
    })
  },

  async update(id: string, input: UpdateUserInput) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } })
    if (!user) throw ApiError.notFound("User not found")

    return prisma.$transaction(async (tx) => {
      if (input.categoryIds) {
        await tx.permission.deleteMany({ where: { userId: id } })
        await tx.permission.createMany({
          data: input.categoryIds.map((categoryId) => ({ userId: id, categoryId, canView: true })),
          skipDuplicates: true,
        })
      }
      return tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          email: input.email,
          role: input.role,
          department: input.department,
          departmentId: (input as any).departmentId || undefined,
          status: input.status,
        },
        select: userSelect,
      })
    })
  },

  async setStatus(id: string, status: "ACTIVE" | "DISABLED") {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } })
    if (!user) throw ApiError.notFound("User not found")
    return prisma.user.update({ where: { id }, data: { status }, select: userSelect })
  },

  async resetPassword(id: string, password: string) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } })
    if (!user) throw ApiError.notFound("User not found")
    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id }, data: { passwordHash } })
    return { success: true }
  },

  async softDelete(id: string, requesterId: string) {
    if (id === requesterId) throw ApiError.badRequest("You cannot delete your own account")
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } })
    if (!user) throw ApiError.notFound("User not found")
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: "DISABLED" },
    })
    return { success: true }
  },
}
