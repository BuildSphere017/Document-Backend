import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"

export const folderService = {
  async list(parentId?: string | null) {
    const folders = await prisma.folder.findMany({
      where: {
        parentId: parentId ?? null,
        deletedAt: null,
      },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            children: {
              where: { deletedAt: null },
            },
            documents: {
              where: { deletedAt: null },
            },
          },
        },
      },
    })

    return folders.map((folder) => ({
      ...folder,
      childCount: folder._count.children,
      documentCount: folder._count.documents,
    }))
  },

  async getById(id: string) {
    const folder = await prisma.folder.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        parent: true,
        children: {
          where: { deletedAt: null },
          orderBy: { name: "asc" },
        },
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
        },
      },
    })

    if (!folder) {
      throw ApiError.notFound("Folder not found")
    }

    return folder
  },

  async create(
    name: string,
    parentId: string | null,
    createdById: string
  ) {
    const trimmedName = name.trim()

    if (!trimmedName) {
      throw ApiError.badRequest("Folder name is required")
    }

    if (parentId) {
      const parent = await prisma.folder.findFirst({
        where: {
          id: parentId,
          deletedAt: null,
        },
      })

      if (!parent) {
        throw ApiError.notFound("Parent folder not found")
      }
    }

    const exists = await prisma.folder.findFirst({
      where: {
        parentId,
        name: {
          equals: trimmedName,
          mode: "insensitive",
        },
        deletedAt: null,
      },
    })

    if (exists) {
      throw ApiError.conflict(
        parentId
          ? "A folder with this name already exists inside this folder"
          : "A root folder with this name already exists"
      )
    }

    return prisma.folder.create({
      data: {
        name: trimmedName,
        parentId,
        createdById,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    })
  },

  async rename(id: string, name: string) {
    const trimmedName = name.trim()

    if (!trimmedName) {
      throw ApiError.badRequest("Folder name is required")
    }

    const folder = await prisma.folder.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    })

    if (!folder) {
      throw ApiError.notFound("Folder not found")
    }

    const exists = await prisma.folder.findFirst({
      where: {
        id: { not: id },
        parentId: folder.parentId,
        name: {
          equals: trimmedName,
          mode: "insensitive",
        },
        deletedAt: null,
      },
    })

    if (exists) {
      throw ApiError.conflict(
        "A folder with this name already exists here"
      )
    }

    return prisma.folder.update({
      where: { id },
      data: {
        name: trimmedName,
      },
    })
  },

  async remove(id: string) {
    const folder = await prisma.folder.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        _count: {
          select: {
            children: {
              where: { deletedAt: null },
            },
            documents: {
              where: { deletedAt: null },
            },
          },
        },
      },
    })

    if (!folder) {
      throw ApiError.notFound("Folder not found")
    }

    if (folder._count.children > 0) {
      throw ApiError.conflict(
        "Cannot delete a folder that still contains subfolders"
      )
    }

    if (folder._count.documents > 0) {
      throw ApiError.conflict(
        "Cannot delete a folder that still contains documents"
      )
    }

    await prisma.folder.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    })

    return { success: true }
  },

  async move(id: string, newParentId: string | null) {
    const folder = await prisma.folder.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    })

    if (!folder) {
      throw ApiError.notFound("Folder not found")
    }

    if (id === newParentId) {
      throw ApiError.badRequest(
        "A folder cannot be moved inside itself"
      )
    }

    if (newParentId) {
      const destination = await prisma.folder.findFirst({
        where: {
          id: newParentId,
          deletedAt: null,
        },
      })

      if (!destination) {
        throw ApiError.notFound("Destination folder not found")
      }

      // Prevent moving a folder into one of its own descendants.
      let currentParentId: string | null = destination.parentId

      while (currentParentId) {
        if (currentParentId === id) {
          throw ApiError.badRequest(
            "A folder cannot be moved inside one of its own subfolders"
          )
        }

        const parent = await prisma.folder.findFirst({
          where: {
            id: currentParentId,
            deletedAt: null,
          },
          select: {
            parentId: true,
          },
        })

        currentParentId = parent?.parentId ?? null
      }
    }

    const exists = await prisma.folder.findFirst({
      where: {
        id: { not: id },
        parentId: newParentId,
        name: {
          equals: folder.name,
          mode: "insensitive",
        },
        deletedAt: null,
      },
    })

    if (exists) {
      throw ApiError.conflict(
        "A folder with the same name already exists in the destination"
      )
    }

    return prisma.folder.update({
      where: { id },
      data: {
        parentId: newParentId,
      },
    })
  },

  async moveDocument(documentId: string, folderId: string | null) {
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
      },
    })

    if (!document) {
      throw ApiError.notFound("Document not found")
    }

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
          deletedAt: null,
        },
      })

      if (!folder) {
        throw ApiError.notFound("Destination folder not found")
      }
    }

    return prisma.document.update({
      where: { id: documentId },
      data: {
        folderId,
      },
      include: {
        folder: true,
        category: true,
      },
    })
  },
}