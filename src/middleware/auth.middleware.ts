import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../config/env.js"
import { prisma } from "../config/prisma.js"
import { ApiError } from "../utils/ApiError.js"
import type { Role } from "@prisma/client"

export interface AuthUser {
  id: string
  role: Role
  fullName: string
  username: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export interface JwtPayload {
  sub: string
  role: Role
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized("Missing access token")

    const token = header.slice(7)
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: "ACTIVE" },
      select: { id: true, role: true, fullName: true, username: true },
    })
    if (!user) throw ApiError.unauthorized("Account not found or disabled")

    req.user = user
    next()
  } catch (err) {
    if (err instanceof ApiError) return next(err)
    next(ApiError.unauthorized("Invalid or expired token"))
  }
}

/** Role guard — use after `authenticate`. */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized())
    if (roles.length && !roles.includes(req.user.role)) {
      return next(ApiError.forbidden("You don't have permission to perform this action"))
    }
    next()
  }
}
