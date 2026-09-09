import type { Request, Response } from "express"

import { folderService } from "../services/folder.service.js"

import { serialize } from "../utils/serialize.js"

export const folderController = {
  async list(req: Request, res: Response) {
    const parentId =
      typeof req.query.parentId === "string"
        ? req.query.parentId
        : null

    res.json(
      serialize(await folderService.list(parentId))
    )
  },

  async getById(req: Request, res: Response) {
    res.json(
      serialize(await folderService.getById(req.params.id))
    )
  },

  async create(req: Request, res: Response) {
    const parentId =
      typeof req.body.parentId === "string"
        ? req.body.parentId
        : null

    res.status(201).json(
      serialize(
        await folderService.create(
          req.body.name,
          parentId,
          req.user!.id
        )
      )
    )
  },

  async rename(req: Request, res: Response) {
    res.json(
      serialize(
        await folderService.rename(
          req.params.id,
          req.body.name
        )
      )
    )
  },

  async remove(req: Request, res: Response) {
    res.json(
      serialize(
        await folderService.remove(req.params.id)
      )
    )
  },

  async move(req: Request, res: Response) {
    const newParentId =
      typeof req.body.parentId === "string"
        ? req.body.parentId
        : null

    res.json(
      serialize(
        await folderService.move(
          req.params.id,
          newParentId
        )
      )
    )
  },

  async moveDocument(req: Request, res: Response) {
    const folderId =
      typeof req.body.folderId === "string"
        ? req.body.folderId
        : null

    res.json(
      serialize(
        await folderService.moveDocument(
          req.params.documentId,
          folderId
        )
      )
    )
  },
}