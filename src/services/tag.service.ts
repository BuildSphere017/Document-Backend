import { prisma } from "../config/prisma.js"

export const tagService = {
  /** List all tags (with document count). */
  async listAll() {
    const tags = await prisma.tag.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { name: "asc" },
    })
    return tags.map((t) => ({ id: t.id, name: t.name, count: t._count.documents }))
  },

  /** Set tags for a document — replaces existing tags. */
  async setForDocument(documentId: string, tagNames: string[]) {
    // Upsert all tags
    const tags = await Promise.all(
      tagNames.map((name) =>
        prisma.tag.upsert({
          where: { name: name.trim().toLowerCase() },
          create: { name: name.trim().toLowerCase() },
          update: {},
        })
      )
    )
    // Replace document tags
    await prisma.documentTag.deleteMany({ where: { documentId } })
    if (tags.length) {
      await prisma.documentTag.createMany({
        data: tags.map((t) => ({ documentId, tagId: t.id })),
        skipDuplicates: true,
      })
    }
    return tags.map((t) => t.name)
  },

  /** Add a single tag to a document. */
  async addToDocument(documentId: string, tagName: string) {
    const tag = await prisma.tag.upsert({
      where: { name: tagName.trim().toLowerCase() },
      create: { name: tagName.trim().toLowerCase() },
      update: {},
    })
    await prisma.documentTag.upsert({
      where: { documentId_tagId: { documentId, tagId: tag.id } },
      create: { documentId, tagId: tag.id },
      update: {},
    })
    return tag.name
  },

  /** Remove a tag from a document. */
  async removeFromDocument(documentId: string, tagName: string) {
    const tag = await prisma.tag.findUnique({ where: { name: tagName.trim().toLowerCase() } })
    if (!tag) return
    await prisma.documentTag.deleteMany({ where: { documentId, tagId: tag.id } })
  },
}
