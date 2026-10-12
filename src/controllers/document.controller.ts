
import type { Request, Response } from "express"
import { createRequire } from "node:module"
import { once } from "node:events"

import { documentService } from "../services/document.service.js"
import { favoriteService } from "../services/favorite.service.js"
import { tagService } from "../services/tag.service.js"
import { searchService } from "../services/search.service.js"
import { exportService } from "../services/export.service.js"
import { storage } from "../storage/supabase.storage.js"
import { serialize } from "../utils/serialize.js"
import { ApiError } from "../utils/ApiError.js"

const require = createRequire(import.meta.url)

const archiver = require("archiver") as (
  format: string,
  options?: { zlib?: { level?: number } },
) => any

/**
 * Creates a safe ZIP entry path, preserves folder structure,
 * and prevents duplicate entry paths.
 */
function safeZipEntryName(
  folderPath: string,
  fileName: string,
  usedNames: Set<string>,
): string {
  const sanitizeSegment = (value: string): string => {
    const cleaned = value
      .replace(/\\/g, "/")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[<>:"|?*]/g, "_")
      .trim()
      .replace(/[. ]+$/g, "")

    return cleaned || "document"
  }

  const folders = folderPath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(sanitizeSegment)

  // Use only the filename, never a path supplied as part of fileName.
  const originalFileName =
    fileName.replace(/\\/g, "/").split("/").pop() || "document"

  const safeFileName = sanitizeSegment(originalFileName)
  const dotIndex = safeFileName.lastIndexOf(".")

  const stem =
    dotIndex > 0 ? safeFileName.slice(0, dotIndex) : safeFileName

  const extension =
    dotIndex > 0 ? safeFileName.slice(dotIndex) : ""

  let candidate = [...folders, safeFileName].join("/")
  let counter = 2

  // ZIP entry paths are checked case-insensitively to avoid
  // duplicate paths on case-insensitive operating systems.
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = [
      ...folders,
      `${stem} (${counter})${extension}`,
    ].join("/")

    counter += 1
  }

  usedNames.add(candidate.toLowerCase())

  return candidate
}

/**
 * Creates a safe filename for the downloaded category ZIP.
 */
function safeArchiveName(categoryName: string): string {
  const safeName = categoryName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "")

  return `${safeName || "Category"}_Documents.zip`
}

export const documentController = {
  async list(req: Request, res: Response) {
    const data = await documentService.list(
      req.user!.id,
      req.user!.role,
      req.query as any,
    )

    res.json(serialize(data))
  },

  async upload(req: Request, res: Response) {
    if (!req.file) {
      throw ApiError.badRequest("No file was uploaded")
    }

    const doc = await documentService.upload(req.file, req.body, {
      id: req.user!.id,
      fullName: req.user!.fullName,
    })

    res.status(201).json(serialize(doc))
  },

  async bulkUpload(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[] | undefined

    if (!files?.length) {
      throw ApiError.badRequest("No files were uploaded")
    }

    const data = await documentService.bulkUpload(files, req.body, {
      id: req.user!.id,
      fullName: req.user!.fullName,
    })

    res.status(201).json(serialize(data))
  },

  async download(req: Request, res: Response) {
    const forceDownload = req.query.download === "true"

    const data = await documentService.getDownloadUrl(
      req.params.id,
      req.user!.id,
      req.user!.role,
      req.user!.fullName,
      forceDownload,
    )

    res.json(serialize(data))
  },

  /**
   * Downloads active PDFs assigned to a category as a ZIP.
   *
   * The route must enforce authorize("ADMIN").
   * documentService.getCategoryZipData() must return only
   * active PDFs and provide each document's folderPath.
   */
  async downloadCategoryZip(req: Request, res: Response) {
    const { categoryName, documents } =
      await documentService.getCategoryZipData(
        req.params.categoryId,
      )

    const archive = archiver("zip", {
      zlib: { level: 1 },
    })

    const usedNames = new Set<string>()

    archive.on("error", (error: Error) => {
      if (!res.destroyed) {
        res.destroy(error)
      }
    })

    res.setHeader("Content-Type", "application/zip")

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeArchiveName(categoryName)}"`,
    )

    res.setHeader("Cache-Control", "no-store")

    archive.pipe(res)

    try {
      for (const doc of documents) {
        const fileStream = await storage.downloadStream(
          doc.storagePath,
        )

        // Wait for the current archive entry before appending
        // the next document.
        const entryFinished = once(archive, "entry")

        archive.append(fileStream, {
          name: safeZipEntryName(
            doc.folderPath ?? "",
            doc.fileName,
            usedNames,
          ),
        })

        await entryFinished
      }

      await archive.finalize()
    } catch (error) {
      if (res.headersSent) {
        res.destroy(
          error instanceof Error
            ? error
            : new Error(String(error)),
        )
        return
      }

      throw error
    }
  },

  async remove(req: Request, res: Response) {
    const data = await documentService.remove(req.params.id, {
      id: req.user!.id,
      fullName: req.user!.fullName,
    })

    res.json(serialize(data))
  },

  async share(req: Request, res: Response) {
    const data = await documentService.createShare(
      req.params.id,
      req.body,
      {
        id: req.user!.id,
        fullName: req.user!.fullName,
      },
    )

    res.json(serialize(data))
  },

  async reprocess(req: Request, res: Response) {
    const data = await documentService.reprocess(req.params.id, {
      id: req.user!.id,
      fullName: req.user!.fullName,
    })

    res.json(serialize(data))
  },

  async togglePin(req: Request, res: Response) {
    const data = await documentService.togglePin(req.params.id)

    res.json(serialize(data))
  },

  // Favorites
  async toggleFavorite(req: Request, res: Response) {
    const data = await favoriteService.toggle(
      req.params.id,
      req.user!.id,
    )

    res.json(serialize(data))
  },

  async listFavorites(req: Request, res: Response) {
    const data = await favoriteService.list(req.user!.id)

    res.json(serialize(data))
  },

  // Tags
  async listTags(req: Request, res: Response) {
    const data = await tagService.listAll()

    res.json(serialize(data))
  },

  async setTags(req: Request, res: Response) {
    const { tags } = req.body

    const data = await tagService.setForDocument(
      req.params.id,
      tags ?? [],
    )

    res.json(serialize(data))
  },

  // Recent searches
  async recentSearches(req: Request, res: Response) {
    const data = await searchService.recent(req.user!.id)

    res.json(serialize(data))
  },

  async clearSearches(req: Request, res: Response) {
    const data = await searchService.clear(req.user!.id)

    res.json(serialize(data))
  },

  // Export
  async exportActivity(req: Request, res: Response) {
    const data = await exportService.activityExcel()

    res.json(serialize(data))
  },

  async exportDocuments(req: Request, res: Response) {
    const data = await exportService.documentsExcel()

    res.json(serialize(data))
  },

  /**
   * Downloads the complete active-document inventory as an XLSX file.
   * The route must enforce authorize("ADMIN").
   */
  async exportDocumentInventory(req: Request, res: Response) {
    const workbook = await exportService.documentInventoryExcel()

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Document_Inventory.xlsx"',
    )

    res.setHeader("Cache-Control", "no-store")

    res.send(workbook)
  },
}
