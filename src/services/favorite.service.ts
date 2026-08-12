import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"

export const favoriteService = {
  /** Toggle favorite — if already favorited, remove it; else add it. */
  async toggle(documentId: string, userId: string) {
    const existing = await prisma.favorite.findUnique({
      where: { userId_documentId: { userId, documentId } },
    })
    if (existing) {
      await prisma.favorite.delete({ where: { userId_documentId: { userId, documentId } } })
      return { favorited: false }
    }
    const doc = await prisma.document.findFirst({ where: { id: documentId, deletedAt: null } })
    if (!doc) throw ApiError.notFound("Document not found")
    await prisma.favorite.create({ data: { userId, documentId } })
    return { favorited: true }
  },

  /** List all favorited documents for a user. */
  async list(userId: string) {
    const favs = await prisma.favorite.findMany({
      where: { userId },
      include: {
        document: {
          include: {
            category: true,
            uploadedBy: { select: { id: true, fullName: true } },
            tags: { include: { tag: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })
    return favs
      .filter((f) => !f.document.deletedAt)
      .map((f) => ({
        ...f.document,
        size: Number(f.document.size),
        tags: f.document.tags.map((t) => t.tag.name),
        favoritedAt: f.createdAt,
      }))
  },

  /** Get set of favorited document IDs for a user (for rendering star state). */
  async getIds(userId: string): Promise<Set<string>> {
    const favs = await prisma.favorite.findMany({ where: { userId }, select: { documentId: true } })
    return new Set(favs.map((f) => f.documentId))
  },
}
