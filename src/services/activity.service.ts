import { prisma } from "../config/prisma.js"
import type { ActivityAction, Prisma } from "@prisma/client"

interface LogInput {
  action: ActivityAction
  actorName: string
  userId?: string | null
  targetType?: string
  targetId?: string
  targetTitle?: string
  meta?: Prisma.InputJsonValue
  ip?: string
}

export const activityService = {
  /** Fire-and-forget activity logging. Never throws into the request path. */
  async log(input: LogInput): Promise<void> {
    try {
      await prisma.activityLog.create({
        data: {
          action: input.action,
          actorName: input.actorName,
          userId: input.userId ?? undefined,
          targetType: input.targetType,
          targetId: input.targetId,
          targetTitle: input.targetTitle,
          meta: input.meta,
          ip: input.ip,
        },
      })
    } catch (err) {
      console.error("[activity] failed to log", err)
    }
  },

  async list(params: { action?: ActivityAction; limit?: number; cursor?: string }) {
    const { action, limit = 50, cursor } = params
    const items = await prisma.activityLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const hasMore = items.length > limit
    return { items: items.slice(0, limit), nextCursor: hasMore ? items[limit - 1].id : null }
  },
}
