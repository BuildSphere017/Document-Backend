import type { Request, Response } from "express"

import { userService } from "../services/user.service.js"

import { activityService } from "../services/activity.service.js"

import { serialize } from "../utils/serialize.js"

export const userController = {
  async list(_req: Request, res: Response) {
    res.json(serialize(await userService.list()))
  },

  async create(req: Request, res: Response) {
    const user = await userService.create(req.body)

    await activityService.log({
      action: "UPLOAD", // treated as an admin action; kept generic
      actorName: req.user!.fullName,
      userId: req.user!.id,
      targetType: "user",
      targetId: user.id,
      targetTitle: user.fullName,
      meta: { event: "user_created" },
    })

    res.status(201).json(serialize(user))
  },

  async update(req: Request, res: Response) {
    res.json(
      serialize(await userService.update(req.params.id, req.body)),
    )
  },

  async disable(req: Request, res: Response) {
    res.json(
      serialize(await userService.setStatus(req.params.id, "DISABLED")),
    )
  },

  async enable(req: Request, res: Response) {
    res.json(
      serialize(await userService.setStatus(req.params.id, "ACTIVE")),
    )
  },

  async resetPassword(req: Request, res: Response) {
    res.json(
      serialize(
        await userService.resetPassword(
          req.params.id,
          req.body.password,
        ),
      ),
    )
  },

  async remove(req: Request, res: Response) {
    res.json(
      serialize(
        await userService.softDelete(
          req.params.id,
          req.user!.id,
        ),
      ),
    )
  },

  // ---------------------------------------------------------
  // CATEGORY ACCESS
  // ---------------------------------------------------------

  async getCategoryAccess(_req: Request, res: Response) {
    res.json(
      serialize(await userService.getCategoryAccess()),
    )
  },

  async updateCategoryAccess(req: Request, res: Response) {
    const categoryIds = Array.isArray(req.body.categoryIds)
      ? req.body.categoryIds
      : []

    const result = await userService.updateCategoryAccess(
      req.params.id,
      categoryIds,
    )

    res.json(serialize(result))
  },
}