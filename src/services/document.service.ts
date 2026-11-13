
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

/**
 * Finds the most recent active document whose file name matches the
 * uploaded file (case-insensitive). This is the identity used for
 * automatic version replacement: re-uploading a file with the same
 * name updates the existing document in place instead of creating a
 * new one.
 */
function findByFileName(fileName: string) {
  return prisma.document.findFirst({
    where: {
      deletedAt: null,
      fileName: { equals: fileName, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
  })
}

/**
 * Replace an existing document's file with a newer upload, preserving
 * the previous file as version history. The document keeps its id,
 * category and folder — only its stored file, checksum and version
 * number change. The old file is archived into DocumentVersion so it
 * stays downloadable, and the AI pipeline re-runs on the new content.
 */
async function createNewVersion(
  existing: {
    id: string
    title: string
    version: number
    storagePath: string
    size: bigint
    checksum: string
    uploadedById: string
  },
  file: Express.Multer.File,
  checksum: string,
  actor: { id: string; fullName: string },
  note?: string,
) {
  const fileType = resolveFileType(file.mimetype)
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${actor.id}/${Date.now()}-${safeName}`

  // Upload the new file first; if this fails nothing in the DB changes.
  await storage.upload(storagePath, file.buffer, file.mimetype)

  // Archive the current file and promote the new one atomically.
  const [, updated] = await prisma.$transaction([
    prisma.documentVersion.create({
      data: {
        documentId: existing.id,
        version: existing.version,
        storagePath: existing.storagePath,
        size: existing.size,
        checksum: existing.checksum,
        uploadedById: existing.uploadedById,
        note: note ?? null,
      },
    }),
    prisma.document.update({
      where: { id: existing.id },
      data: {
        fileName: file.originalname,
        storagePath,
        mimeType: file.mimetype,
        fileType,
        size: BigInt(file.size),
        checksum,
        version: { increment: 1 },
        status: "PROCESSING",
      },
      include: docInclude,
    }),
  ])

  await prisma.user
    .update({
      where: { id: actor.id },
      data: { storageUsed: { increment: BigInt(file.size) } },
    })
    .catch(() => {})

  await activityService.log({
    action: "UPLOAD",
    actorName: actor.fullName,
    userId: actor.id,
    targetType: "document",
    targetId: existing.id,
    targetTitle: updated.title,
    meta: { versioned: true, version: updated.version },
  })

  await prisma.notification
    .create({
      data: {
        userId: actor.id,
        title: "New version uploaded",
        body: `"${updated.title}" was updated to version ${updated.version}. The previous version was saved to history.`,
        type: "upload",
        link: "/documents",
      },
    })
    .catch(() => {})

  // Re-extract, re-chunk and re-embed the new content for AI search.
  void processDocument(existing.id)

  return shapeDoc(updated)
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

    
// Text search is pushed down to Postgres so only the current page
// is read, not the whole table. Each search term must appear in at
// least one of title / fileName / keyword / description (case
// insensitive); all terms must match (AND of per-term OR). Also
// matches the raw query as typed, so a multi-word phrase still works.
if (q?.trim()) {
  const raw = q.trim()

  const terms = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const fieldsContain = (needle: string) => ({
    OR: [
      { title: { contains: needle, mode: "insensitive" as const } },
      { fileName: { contains: needle, mode: "insensitive" as const } },
      { keyword: { contains: needle, mode: "insensitive" as const } },
      { description: { contains: needle, mode: "insensitive" as const } },
    ],
  })

  // Match when EITHER every term appears somewhere, OR the whole
  // query (as typed) appears in a single field.
  if (terms.length) {
    where.AND = [
      {
        OR: [
          { AND: terms.map(fieldsContain) },
          fieldsContain(raw),
        ],
      },
    ]
  } else {
    where.AND = [fieldsContain(raw)]
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

    // Automatic version replacement: if a document with the same file
    // name already exists, update it in place (keeping its folder and
    // category) and archive the old file as version history — unless the
    // bytes are identical, in which case there is nothing to update.
    const existingByName = await findByFileName(file.originalname)

    if (existingByName) {
      if (existingByName.checksum === checksum) {
        throw ApiError.conflict(
          `"${existingByName.title}" already contains this exact file — no changes detected.`,
          { documentId: existingByName.id, unchanged: true },
        )
      }

      const updated = await createNewVersion(
        existingByName,
        file,
        checksum,
        actor,
      )

      return Object.assign(updated, { action: "versioned" as const })
    }

    // No name match — guard against the same bytes uploaded under a
    // different name (a true duplicate).
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
      status: "uploaded" | "versioned" | "duplicate" | "failed"
      title?: string
      version?: number
    }[] = []

    for (const file of files) {
      try {
        const checksum = crypto
          .createHash("sha256")
          .update(file.buffer)
          .digest("hex")

        // Same file name → replace in place as a new version (unless the
        // bytes are unchanged). Keeps the document in its existing folder.
        const existingByName = await findByFileName(file.originalname)

        if (existingByName) {
          if (existingByName.checksum === checksum) {
            results.push({
              fileName: file.originalname,
              status: "duplicate",
            })
            continue
          }

          const updated = await createNewVersion(
            existingByName,
            file,
            checksum,
            actor,
          )

          results.push({
            fileName: file.originalname,
            status: "versioned",
            title: updated.title,
            version: updated.version,
          })
          continue
        }

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

    const versioned = results.filter(
      (r) => r.status === "versioned",
    ).length

    if (uploaded > 0 || versioned > 0) {
      const parts: string[] = []
      if (uploaded > 0) parts.push(`${uploaded} new`)
      if (versioned > 0) parts.push(`${versioned} updated to a new version`)

      await prisma.notification
        .create({
          data: {
            userId: actor.id,
            title: "Bulk upload complete",
            body: `${parts.join(" · ")} (of ${files.length} file(s)) — processing for AI search.`,
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
    actor: { id: string; fullName: string; role: Role },
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

    // A user may only share a document they are allowed to view.
    const allowed = await visibleCategoryIds(actor.id, actor.role)

    if (
      allowed !== null &&
      doc.categoryId &&
      !allowed.includes(doc.categoryId)
    ) {
      throw ApiError.forbidden(
        "You don't have access to this document",
      )
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

  /**
   * List the version history of a document: the current (live) version
   * plus every archived previous version, newest first. Enforces the
   * same category-level view permission as download.
   */
  async listVersions(id: string, userId: string, role: Role) {
    const doc = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        fileName: true,
        size: true,
        version: true,
        categoryId: true,
        updatedAt: true,
      },
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
      throw ApiError.forbidden("You don't have access to this document")
    }

    const history = await prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { version: "desc" },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
      },
    })

    return {
      documentId: doc.id,
      title: doc.title,
      current: {
        version: doc.version,
        fileName: doc.fileName,
        size: Number(doc.size),
        createdAt: doc.updatedAt,
        isCurrent: true,
      },
      history: history.map((v) => ({
        version: v.version,
        size: Number(v.size),
        note: v.note,
        uploadedBy: v.uploadedBy?.fullName ?? null,
        createdAt: v.createdAt,
        isCurrent: false,
      })),
    }
  },

  /**
   * Build a signed URL for a specific version of a document. The current
   * version resolves to the live file; older versions resolve to their
   * archived copy. Enforces the same category-level view permission.
   */
  async getVersionDownloadUrl(
    id: string,
    version: number,
    userId: string,
    role: Role,
    actorName: string,
  ) {
    const doc = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        fileName: true,
        version: true,
        storagePath: true,
        categoryId: true,
      },
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
      throw ApiError.forbidden("You don't have access to this document")
    }

    let storagePath = doc.storagePath

    if (version !== doc.version) {
      const archived = await prisma.documentVersion.findFirst({
        where: { documentId: id, version },
        select: { storagePath: true },
      })

      if (!archived) {
        throw ApiError.notFound("That version was not found")
      }

      storagePath = archived.storagePath
    }

    const dotIndex = doc.fileName.lastIndexOf(".")
    const stem =
      dotIndex > 0 ? doc.fileName.slice(0, dotIndex) : doc.fileName
    const ext = dotIndex > 0 ? doc.fileName.slice(dotIndex) : ""
    const downloadName = `${stem} (v${version})${ext}`

    const url = await storage.signedUrl(storagePath, 60 * 60, downloadName)

    await activityService.log({
      action: "DOWNLOAD",
      actorName,
      userId,
      targetType: "document",
      targetId: doc.id,
      targetTitle: doc.title,
      meta: { version },
    })

    return { url, fileName: downloadName, version }
  },

  /**
   * Restore an older version as the current file. This is
   * non-destructive: the current file is first archived to history,
   * then a new version is created whose content equals the chosen old
   * version. The document keeps its id, folder and category. The AI
   * pipeline re-runs so search reflects the restored content.
   */
  async revertToVersion(
    id: string,
    version: number,
    actor: { id: string; fullName: string },
  ) {
    const doc = await prisma.document.findFirst({
      where: { id, deletedAt: null },
    })

    if (!doc) {
      throw ApiError.notFound("Document not found")
    }

    if (version === doc.version) {
      throw ApiError.badRequest("That version is already the current one")
    }

    const target = await prisma.documentVersion.findFirst({
      where: { documentId: id, version },
    })

    if (!target) {
      throw ApiError.notFound("That version was not found")
    }

    const [, updated] = await prisma.$transaction([
      // Archive the current live file so nothing is lost.
      prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          version: doc.version,
          storagePath: doc.storagePath,
          size: doc.size,
          checksum: doc.checksum,
          uploadedById: doc.uploadedById,
          note: `Replaced by revert to v${version}`,
        },
      }),
      // Promote the chosen version's file to current.
      prisma.document.update({
        where: { id: doc.id },
        data: {
          storagePath: target.storagePath,
          size: target.size,
          checksum: target.checksum,
          version: { increment: 1 },
          status: "PROCESSING",
        },
        include: docInclude,
      }),
    ])

    await activityService.log({
      action: "UPLOAD",
      actorName: actor.fullName,
      userId: actor.id,
      targetType: "document",
      targetId: doc.id,
      targetTitle: updated.title,
      meta: { reverted: true, from: version, to: updated.version },
    })

    await prisma.notification
      .create({
        data: {
          userId: actor.id,
          title: "Version restored",
          body: `"${updated.title}" was restored from version ${version} (now version ${updated.version}).`,
          type: "info",
          link: "/documents",
        },
      })
      .catch(() => {})

    void processDocument(doc.id)

    return shapeDoc(updated)
  },
}
