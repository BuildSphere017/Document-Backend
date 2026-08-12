import type { Request, Response } from "express"
import { settingsService } from "../services/settings.service.js"
import { serialize } from "../utils/serialize.js"

export const settingsController = {
  async profile(req: Request, res: Response) {
    res.json(serialize(await settingsService.getProfile(req.user!.id)))
  },
  async updateProfile(req: Request, res: Response) {
    res.json(serialize(await settingsService.updateProfile(req.user!.id, req.body)))
  },
  async changePassword(req: Request, res: Response) {
    const { currentPassword, newPassword } = req.body
    res.json(serialize(await settingsService.changePassword(req.user!.id, currentPassword, newPassword)))
  },
  async system(_req: Request, res: Response) {
    res.json(serialize(await settingsService.systemInfo()))
  },
}
