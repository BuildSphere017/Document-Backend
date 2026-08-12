import type { Request, Response } from "express"
import { authService } from "../services/auth.service.js"
import { serialize } from "../utils/serialize.js"

export const authController = {
  async login(req: Request, res: Response) {
    const ip = req.ip
    const result = await authService.login(req.body, ip)
    res.json(serialize(result))
  },

  async me(req: Request, res: Response) {
    const user = await authService.me(req.user!.id)
    res.json(serialize(user))
  },

  async logout(_req: Request, res: Response) {
    // Stateless JWT — client discards the token. Endpoint exists for symmetry/audit.
    res.json({ success: true })
  },
}
