import type { Request, Response } from "express"
import { departmentService } from "../services/department.service.js"
import { serialize } from "../utils/serialize.js"

export const departmentController = {
  async list(_req: Request, res: Response) {
    res.json(serialize(await departmentService.list()))
  },
  async create(req: Request, res: Response) {
    res.status(201).json(serialize(await departmentService.create(req.body)))
  },
  async update(req: Request, res: Response) {
    res.json(serialize(await departmentService.update(req.params.id, req.body)))
  },
  async remove(req: Request, res: Response) {
    res.json(serialize(await departmentService.remove(req.params.id)))
  },
}
