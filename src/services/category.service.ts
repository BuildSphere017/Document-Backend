import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"
import type { CreateCategoryInput, UpdateCategoryInput } from "../validation/category.validation.js"

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export const categoryService = {
  async list(includeArchived = false) {
    const categories = await prisma.category.findMany({
      where: { deletedAt: null, ...(includeArchived ? {} : { archived: false }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
    })
    return categories.map((c) => ({ ...c, documentCount: c._count.documents }))
  },

  async create(input: CreateCategoryInput) {
    const slug = slugify(input.name)
    const exists = await prisma.category.findFirst({
      where: { OR: [{ name: input.name }, { slug }], deletedAt: null },
    })
    if (exists) throw ApiError.conflict("A category with this name already exists")

    const count = await prisma.category.count()
    return prisma.category.create({
      data: {
        name: input.name,
        slug,
        color: input.color ?? "#2563EB",
        icon: input.icon,
        description: input.description,
        sortOrder: count,
      },
    })
  },

  async update(id: string, input: UpdateCategoryInput) {
    const category = await prisma.category.findFirst({ where: { id, deletedAt: null } })
    if (!category) throw ApiError.notFound("Category not found")
    return prisma.category.update({
      where: { id },
      data: {
        ...input,
        ...(input.name ? { slug: slugify(input.name) } : {}),
      },
    })
  },

  async remove(id: string) {
    const category = await prisma.category.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
    })
    if (!category) throw ApiError.notFound("Category not found")
    if (category._count.documents > 0) {
      throw ApiError.conflict("Cannot delete a category that still contains documents")
    }
    await prisma.category.update({ where: { id }, data: { deletedAt: new Date() } })
    return { success: true }
  },
}
