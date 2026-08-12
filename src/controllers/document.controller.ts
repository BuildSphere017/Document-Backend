import type { Request, Response } from "express"
import { documentService } from "../services/document.service.js"
import { favoriteService } from "../services/favorite.service.js"
import { tagService } from "../services/tag.service.js"
import { searchService } from "../services/search.service.js"
import { exportService } from "../services/export.service.js"
import { serialize } from "../utils/serialize.js"
import { ApiError } from "../utils/ApiError.js"

export const documentController = {
  async list(req: Request, res: Response) {
    const data = await documentService.list(req.user!.id, req.user!.role, req.query as any)
    res.json(serialize(data))
  },

  async upload(req: Request, res: Response) {
    if (!req.file) throw ApiError.badRequest("No file was uploaded")
    const doc = await documentService.upload(req.file, req.body, {
      id: req.user!.id,
      fullName: req.user!.fullName,
    })
    res.status(201).json(serialize(doc))
  },

  async bulkUpload(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[] | undefined
    if (!files?.length) throw ApiError.badRequest("No files were uploaded")
    const data = await documentService.bulkUpload(files, req.body, {
      id: req.user!.id, fullName: req.user!.fullName,
    })
    res.status(201).json(serialize(data))
  },

 async download(req: Request, res: Response) {
  const forceDownload =
    req.query.download === "true"

  const data =
    await documentService.getDownloadUrl(
      req.params.id,
      req.user!.id,
      req.user!.role,
      req.user!.fullName,
      forceDownload
    )

  res.json(serialize(data))
},

  async remove(req: Request, res: Response) {
    const data = await documentService.remove(req.params.id, {
      id: req.user!.id, fullName: req.user!.fullName,
    })
    res.json(serialize(data))
  },

  async share(req: Request, res: Response) {
    const data = await documentService.createShare(req.params.id, req.body, {
      id: req.user!.id, fullName: req.user!.fullName,
    })
    res.json(serialize(data))
  },

  async reprocess(req: Request, res: Response) {
    const data = await documentService.reprocess(req.params.id, {
      id: req.user!.id, fullName: req.user!.fullName,
    })
    res.json(serialize(data))
  },

  async togglePin(req: Request, res: Response) {
    const data = await documentService.togglePin(req.params.id)
    res.json(serialize(data))
  },

  // ── Favorites ──
  async toggleFavorite(req: Request, res: Response) {
    const data = await favoriteService.toggle(req.params.id, req.user!.id)
    res.json(serialize(data))
  },
  async listFavorites(req: Request, res: Response) {
    const data = await favoriteService.list(req.user!.id)
    res.json(serialize(data))
  },

  // ── Tags ──
  async listTags(req: Request, res: Response) {
    const data = await tagService.listAll()
    res.json(serialize(data))
  },
  async setTags(req: Request, res: Response) {
    const { tags } = req.body
    const data = await tagService.setForDocument(req.params.id, tags ?? [])
    res.json(serialize(data))
  },

  // ── Recent searches ──
  async recentSearches(req: Request, res: Response) {
    const data = await searchService.recent(req.user!.id)
    res.json(serialize(data))
  },
  async clearSearches(req: Request, res: Response) {
    const data = await searchService.clear(req.user!.id)
    res.json(serialize(data))
  },

  // ── Export ──
  async exportActivity(req: Request, res: Response) {
    const data = await exportService.activityExcel()
    res.json(serialize(data))
  },
  async exportDocuments(req: Request, res: Response) {
    const data = await exportService.documentsExcel()
    res.json(serialize(data))
  },
}
