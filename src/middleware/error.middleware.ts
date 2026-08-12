import type { Request, Response, NextFunction } from "express"
import { Prisma } from "@prisma/client"
import { ApiError } from "../utils/ApiError.js"
import { env } from "../config/env.js"

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound("Route not found"))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Known application error
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    })
  }

  // Prisma unique-constraint violation → 409
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const field = (err.meta?.target as string[])?.join(", ") ?? "field"
      return res.status(409).json({ message: `A record with this ${field} already exists` })
    }
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Record not found" })
    }
  }

  console.error("[error]", err)
  return res.status(500).json({
    message: "Internal server error",
    ...(env.isProd ? {} : { error: err instanceof Error ? err.message : String(err) }),
  })
}
