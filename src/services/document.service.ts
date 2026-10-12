
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { prisma } from "../config/prisma.js"
import { storage } from "../storage/supabase.storage.js"
import { ApiError } from "../utils/ApiError.js"
import { resolveFileType } from "../utils/fileType.js"
import { activityService } from "./activity.service.js"
import { processDocument } from "../ai/pipeline.js"
import type { Role } from "@prisma/client"
import type {
  UploadDocumentInput,
  ListDocumentsInput,
} from "../validation/document.validation.js"

const docInclude = {
  category: true,
  uploadedBy: { select: { id: true, fullName: true } },
  tags: { include: { tag: true } },
} as const

/** Categories a SALES user is allowed to see. ADMIN/MANAGER see all. */
async function visibleCategoryIds(
  userId: string,
  role: Role,
): Promise<string[] | null> {
  if (role === "ADMIN" || role === "MANAGER") return null

  const perms = await prisma.permission.findMany({
    where: { userId, canView: true },
    select: { categoryId: true },
  })

  return perms.map((p) => p.categoryId)
}

function shapeDoc(d: any) {
  return {
    ...d,
    size: Number(d.size),
    tags: d.tags?.map((t: any) => t.tag.name) ?? [],
  }
}

export const documentService = {
  async list(
    userId: string,
    role: Role,
    params: ListDocumentsInput,
  ) {
    const {
      q,
      categoryId,
      folderId,
      page,
      pageSize,
      tagId,
      pinned,
    } = params as any

    const allowed = await visibleCategoryIds(userId, role)

    const where: any = { deletedAt: null }

    if (allowed !== null) {
      where.categoryId = {
        in: allowed.length ? allowed : ["__none__"],
      }
    }

    if (categoryId) where.categoryId = categoryId

    if (folderId) where.folderId = folderId

    if (tagId) {
      where.tags = {
        some: {
          tag: {
            id: tagId,
          },
        },
      }
    }

    
if (q?.trim()) {
  const normalizeSearch = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")

  const searchTerms = normalizeSearch(q)
    .split(" ")
    .filter(Boolean)

  const compactQuery = normalizeSearch(q).replace(/\s+/g, "")

  const documents = await prisma.document.findMany({
    where: {
      ...where,
    },
    include: docInclude,
    orderBy: { createdAt: "desc" },
  })

  const matchedDocuments = documents.filter((doc) => {
    const searchableText = [
      doc.title,
      doc.fileName,
      doc.keyword,
      doc.description,
    ]
      .filter(Boolean)
      .map((value) => normalizeSearch(String(value)))

    const compactFields = searchableText.map((value) =>
      value.replace(/\s+/g, ""),
    )

    const allTermsMatch =
      searchTerms.length > 0 &&
      searchTerms.every((term) =>
        searchableText.some((value) => value.includes(term)),
      )

    const compactMatch =
      compactQuery.length > 0 &&
      compactFields.some((value) => value.includes(compactQuery))

    return allTermsMatch || compactMatch
  })

  const total = matchedDocuments.length
  const items = matchedDocuments.slice(
    (page - 1) * pageSize,
    page * pageSize,
  )

  return {
    items: items.map(shapeDoc),
    total,
    page,
    pageSize,
  }
}


    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: docInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),

      prisma.document.count({ where }),
    ])

    return {
      items: items.map(shapeDoc),
      total,
      page,
      pageSize,
    }
  },

  async upload(
    file: Express.Multer.File,
    input: UploadDocumentInput,
    actor: { id: string; fullName: string },
  ) {
    if (!storage.enabled) {
      throw ApiError.internal(
        "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      )
    }

    const checksum = crypto
      .createHash("sha256")
      .update(file.buffer)
      .digest("hex")

    const duplicate = await prisma.document.findFirst({
      where: {
        checksum,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
      },
    })

    if (duplicate) {
      throw ApiError.conflict(
        `This file is already in the library as "${duplicate.title}"`,
        { documentId: duplicate.id },
      )
    }

    const fileType = resolveFileType(file.mimetype)
    const safeName = file.originalname.replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    )
    const storagePath = `${actor.id}/${Date.now()}-${safeName}`

    await storage.upload(
      storagePath,
      file.buffer,
      file.mimetype,
    )

    const doc = await prisma.document.create({
      data: {
        title: input.title,
        description: input.description,
        keyword: input.keyword,
        fileName: file.originalname,
        storagePath,
        mimeType: file.mimetype,
        fileType,
        size: BigInt(file.size),
        checksum,
        status: "PROCESSING",
        categoryId: input.categoryId,
        folderId: input.folderId,
        uploadedById: actor.id,
      },
      include: docInclude,
    })

    await prisma.user.update({
      where: { id: actor.id },
      data: {
        storageUsed: {
          increment: BigInt(file.size),
        },
      },
    })

    await activityService.log({
      action: "UPLOAD",
      actorName: actor.fullName,
      userId: actor.id,
      targetType: "document",
      targetId: doc.id,
      targetTitle: doc.title,
    })

    await prisma.notification
      .create({
        data: {
          userId: actor.id,
          title: "Document uploaded",
          body: `"${doc.title}" was uploaded and is being processed for AI search.`,
          type: "upload",
          link: "/documents",
        },
      })
      .catch(() => {})

    void processDocument(doc.id)

    return shapeDoc(doc)
  },

  /** Upload many files at once. Each becomes its own document. */
  async bulkUpload(
    files: Express.Multer.File[],
    input: {
      categoryId?: string
      folderId?: string
    },
    actor: { id: string; fullName: string },
  ) {
    if (!storage.enabled) {
      throw ApiError.internal("Supabase Storage is not configured.")
    }

    const results: {
      fileName: string
      status: "uploaded" | "duplicate" | "failed"
      title?: string
    }[] = []

    for (const file of files) {
      try {
        const checksum = crypto
          .createHash("sha256")
          .update(file.buffer)
          .digest("hex")

        const duplicate = await prisma.document.findFirst({
          where: {
            checksum,
            deletedAt: null,
          },
          select: { id: true },
        })

        if (duplicate) {
          results.push({
            fileName: file.originalname,
            status: "duplicate",
          })
          continue
        }

        const fileType = resolveFileType(file.mimetype)
        const safeName = file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        )
        const storagePath = `${actor.id}/${Date.now()}-${safeName}`

        await storage.upload(
          storagePath,
          file.buffer,
          file.mimetype,
        )

        const title = file.originalname.replace(/\.[^.]+$/, "")

        const doc = await prisma.document.create({
          data: {
            title,
            fileName: file.originalname,
            storagePath,
            mimeType: file.mimetype,
            fileType,
            size: BigInt(file.size),
            checksum,
            status: "PROCESSING",
            categoryId: input.categoryId,
            folderId: input.folderId,
            uploadedById: actor.id,
          },
        })

        await prisma.user.update({
          where: { id: actor.id },
          data: {
            storageUsed: {
              increment: BigInt(file.size),
            },
          },
        })

        await activityService.log({
          action: "UPLOAD",
          actorName: actor.fullName,
          userId: actor.id,
          targetType: "document",
          targetId: doc.id,
          targetTitle: doc.title,
        })

        void processDocument(doc.id)

        results.push({
          fileName: file.originalname,
          status: "uploaded",
          title,
        })
      } catch (err) {
        console.error(
          `[bulkUpload] failed for ${file.originalname}:`,
          (err as Error).message,
        )

        results.push({
          fileName: file.originalname,
          status: "failed",
        })
      }
    }

    const uploaded = results.filter(
      (r) => r.status === "uploaded",
    ).length

    if (uploaded > 0) {
      await prisma.notification
        .create({
          data: {
            userId: actor.id,
            title: "Bulk upload complete",
            body: `${uploaded} of ${files.length} document(s) uploaded and processing.`,
            type: "upload",
            link: "/documents",
          },
        })
        .catch(() => {})
    }

    return {
      total: files.length,
      results,
    }
  },

  /**
   * Return active PDFs for an Admin category ZIP export.
   * Only documents belonging to the selected category are included.
   * Folder paths are preserved when the folder tree has a root folder
   * matching the category name. Documents elsewhere remain at ZIP root.
   * The HTTP route must enforce authorize("ADMIN").
   */
  async getCategoryZipData(categoryId: string) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
      },
    })

    if (!category) {
      throw ApiError.notFound("Category not found")
    }

    const folders = await prisma.folder.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        parentId: true,
      },
    })

    const folderById = new Map(
      folders.map((folder) => [folder.id, folder]),
    )

    const folderPaths = new Map<string, string>()

    const getFolderPath = (
      folderId: string,
      visited = new Set<string>(),
    ): string => {
      const cached = folderPaths.get(folderId)
      if (cached !== undefined) return cached

      if (visited.has(folderId)) return ""

      const folder = folderById.get(folderId)
      if (!folder) return ""

      visited.add(folderId)

      const parentPath = folder.parentId
        ? getFolderPath(folder.parentId, visited)
        : ""

      visited.delete(folderId)

      const path = parentPath
        ? `${parentPath}/${folder.name}`
        : folder.name

      folderPaths.set(folderId, path)
      return path
    }

    const rootFolderIds = new Set(
      folders
        .filter(
          (folder) =>
            folder.parentId === null &&
            folder.name.toLowerCase() === category.name.toLowerCase(),
        )
        .map((folder) => folder.id),
    )

    const categoryFolderIds = new Set<string>()

    for (const folder of folders) {
      let current: (typeof folder) | undefined = folder
      const visited = new Set<string>()

      while (current) {
        if (visited.has(current.id)) break
        visited.add(current.id)

        if (rootFolderIds.has(current.id)) {
          categoryFolderIds.add(folder.id)
          break
        }

        current = current.parentId
          ? folderById.get(current.parentId)
          : undefined
      }
    }

    const documents = await prisma.document.findMany({
      where: {
        categoryId: category.id,
        deletedAt: null,
        OR: [
          {
            mimeType: {
              equals: "application/pdf",
              mode: "insensitive",
            },
          },
          {
            fileName: {
              endsWith: ".pdf",
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        fileName: true,
        storagePath: true,
        folderId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    })

    if (documents.length === 0) {
      throw ApiError.notFound(
        "No active PDF documents found in this category",
      )
    }

    const uniqueDocuments = new Map(
      documents.map((document) => [
        document.id,
        {
          ...document,
          folderPath:
            document.folderId &&
            categoryFolderIds.has(document.folderId)
              ? getFolderPath(document.folderId)
              : "",
        },
      ]),
    )

    return {
      categoryName: category.name,
      documents: Array.from(uniqueDocuments.values()),
    }
  },

  async getDownloadUrl(
    id: string,
    userId: string,
    role: Role,
    actorName: string,
    forceDownload = false,
  ) {
    const doc = await prisma.document.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: docInclude,
    })

    if (!doc) {
      throw ApiError.notFound("Document not found")
    }

    const allowed = await visibleCategoryIds(userId, role)

    if (
      allowed !== null &&
      doc.categoryId &&
      !allowed.includes(doc.categoryId)
    ) {
      throw ApiError.forbidden(
        "You don't have access to this document",
      )
    }

    const url = await storage.signedUrl(
      doc.storagePath,
      60 * 60,
      forceDownload ? doc.fileName : undefined,
    )

    if (forceDownload) {
      await prisma.document.update({
        where: { id },
        data: {
          downloadCount: {
            increment: 1,
          },
        },
      })

      await activityService.log({
        action: "DOWNLOAD",
        actorName,
        userId,
        targetType: "document",
        targetId: doc.id,
        targetTitle: doc.title,
      })
    }

    return {
      url,
      fileName: doc.fileName,
    }
  },

  async remove(
    id: string,
    actor: { id: string; fullName: string },
  ) {
    const doc = await prisma.document.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    })

    if (!doc) {
      throw ApiError.notFound("Document not found")
    }

    await prisma.document.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    })

    await prisma.user
      .update({
        where: { id: doc.uploadedById },
        data: {
          storageUsed: {
            decrement: doc.size,
          },
        },
      })
      .catch(() => {})

    await activityService.log({
      action: "DELETE",
      actorName: actor.fullName,
      userId: actor.id,
      targetType: "document",
      targetId: doc.id,
      targetTitle: doc.title,
    })

    return {
      success: true,
    }
  },

  async createShare(
    id: string,
    input: {
      password?: string
      expiresInHours?: number
      maxViews?: number
    },
    actor: { id: string; fullName: string },
  ) {
    const doc = await prisma.document.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    })

    if (!doc) {
      throw ApiError.notFound("Document not found")
    }

    const passwordHash = input.password
      ? await bcrypt.hash(input.password, 10)
      : undefined

    const expiresAt = input.expiresInHours
      ? new Date(
          Date.now() + input.expiresInHours * 3600 * 1000,
        )
      : undefined

    const share = await prisma.share.create({
      data: {
        documentId: id,
        createdById: actor.id,
        passwordHash,
        expiresAt,
        maxViews: input.maxViews,
      },
    })

    await activityService.log({
      action: "SHARE",
      actorName: actor.fullName,
      userId: actor.id,
      targetType: "document",
      targetId: doc.id,
      targetTitle: doc.title,
    })

    await prisma.notification
      .create({
        data: {
          userId: actor.id,
          title: "Share link created",
          body: `You created a share link for "${doc.title}".`,
          type: "share",
          link: "/documents",
        },
      })
      .catch(() => {})

    return {
      token: share.token,
      url: `/share/${share.token}`,
      expiresAt: share.expiresAt,
      passwordProtected: Boolean(passwordHash),
    }
  },

  /** Toggle pin status for a document (admin only). */
  async togglePin(id: string) {
    const doc = await prisma.document.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    })

    if (!doc) {
      throw ApiError.notFound("Document not found")
    }

    const current =
      await prisma.$queryRawUnsafe<{ isPinned: boolean }[]>(
        `SELECT "isPinned" FROM "Document" WHERE id = $1`,
        id,
      )

    const newVal = !(current[0]?.isPinned ?? false)

    await prisma.$executeRawUnsafe(
      `UPDATE "Document" SET "isPinned" = $1 WHERE id = $2`,
      newVal,
      id,
    )

    return {
      isPinned: newVal,
    }
  },

  /** Re-run the AI pipeline for a document. */
  async reprocess(
    id: string,
    actor: { id: string; fullName: string },
  ) {
    const doc = await prisma.document.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    })

    if (!doc) {
      throw ApiError.notFound("Document not found")
    }

    await prisma.document.update({
      where: { id },
      data: {
        status: "PROCESSING",
      },
    })

    void processDocument(id)

    await prisma.notification
      .create({
        data: {
          userId: actor.id,
          title: "Re-processing started",
          body: `"${doc.title}" is being re-processed for AI search.`,
          type: "info",
          link: "/documents",
        },
      })
      .catch(() => {})

    return {
      success: true,
    }
  },
}
