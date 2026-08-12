import type { Request, Response } from "express"
import { categoryService } from "../services/category.service.js"
import { serialize } from "../utils/serialize.js"

export const categoryController = {
  async list(req: Request, res: Response) {
    const includeArchived = req.query.includeArchived === "true"
    res.json(serialize(await categoryService.list(includeArchived)))
  },

  async create(req: Request, res: Response) {
    res.status(201).json(serialize(await categoryService.create(req.body)))
  },

  async update(req: Request, res: Response) {
    res.json(serialize(await categoryService.update(req.params.id, req.body)))
  },

  async remove(req: Request, res: Response) {
    res.json(serialize(await categoryService.remove(req.params.id)))
  },
}
