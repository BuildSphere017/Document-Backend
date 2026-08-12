import type { Request, Response } from "express"
import { dashboardService } from "../services/dashboard.service.js"
import { serialize } from "../utils/serialize.js"

export const dashboardController = {
  async overview(req: Request, res: Response) {
    const data = await dashboardService.overview(req.user!.id, req.user!.role)
    res.json(serialize(data))
  },
}
