import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"

export const departmentService = {
  async list() {
    return prisma.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    })
  },

  async create(data: { name: string; description?: string; color?: string }) {
    const exists = await prisma.department.findUnique({ where: { name: data.name } })
    if (exists) throw ApiError.conflict("Department name already exists")
    return prisma.department.create({ data, include: { _count: { select: { users: true } } } })
  },

  async update(id: string, data: { name?: string; description?: string; color?: string }) {
    const dept = await prisma.department.findUnique({ where: { id } })
    if (!dept) throw ApiError.notFound("Department not found")
    return prisma.department.update({ where: { id }, data, include: { _count: { select: { users: true } } } })
  },

  async remove(id: string) {
    const dept = await prisma.department.findUnique({ where: { id }, include: { _count: { select: { users: true } } } })
    if (!dept) throw ApiError.notFound("Department not found")
    if (dept._count.users > 0) throw ApiError.badRequest(`Cannot delete — ${dept._count.users} user(s) belong to this department`)
    await prisma.department.delete({ where: { id } })
    return { success: true }
  },
}
