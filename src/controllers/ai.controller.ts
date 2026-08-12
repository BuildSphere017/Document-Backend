import type { Request, Response } from "express"
import { aiService } from "../services/ai.service.js"
import { serialize } from "../utils/serialize.js"

export const aiController = {
  async search(req: Request, res: Response) {
    const data = await aiService.search(req.body.query, req.user!.id, req.user!.role, req.user!.fullName)
    res.json(serialize(data))
  },
  async chat(req: Request, res: Response) {
    const { question, documentId } = req.body
    const data = await aiService.chat(question, req.user!.id, req.user!.role, req.user!.fullName, documentId)
    res.json(serialize(data))
  },
}
