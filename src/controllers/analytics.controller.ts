import type { Request, Response } from "express"
import { analyticsService } from "../services/analytics.service.js"
import { serialize } from "../utils/serialize.js"

export const analyticsController = {
  async overview(_req: Request, res: Response) {
    res.json(serialize(await analyticsService.overview()))
  },
}
