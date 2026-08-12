import type { Request, Response } from "express"
import { activityService } from "../services/activity.service.js"
import { serialize } from "../utils/serialize.js"
import type { ActivityAction } from "@prisma/client"

export const activityController = {
  async list(req: Request, res: Response) {
    const action = req.query.action as ActivityAction | undefined
    const limit = Math.min(Number(req.query.limit ?? 50), 100)
    const cursor = req.query.cursor as string | undefined
    res.json(serialize(await activityService.list({ action, limit, cursor })))
  },
}
