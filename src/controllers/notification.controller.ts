import type { Request, Response } from "express"
import { notificationService } from "../services/notification.service.js"
import { serialize } from "../utils/serialize.js"

export const notificationController = {
  async list(req: Request, res: Response) {
    res.json(serialize(await notificationService.list(req.user!.id)))
  },
  async markRead(req: Request, res: Response) {
    res.json(serialize(await notificationService.markRead(req.user!.id, req.params.id)))
  },
  async markAllRead(req: Request, res: Response) {
    res.json(serialize(await notificationService.markAllRead(req.user!.id)))
  },
}
