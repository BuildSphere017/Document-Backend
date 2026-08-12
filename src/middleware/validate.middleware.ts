import type { Request, Response, NextFunction } from "express"
import { ZodError, type ZodSchema } from "zod"
import { ApiError } from "../utils/ApiError.js"

type Part = "body" | "query" | "params"

/** Validates and coerces a request part against a Zod schema. */
export function validate(schema: ZodSchema, part: Part = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req[part] = schema.parse(req[part]) as never
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          ApiError.badRequest(
            "Validation failed",
            err.errors.map((e) => ({ path: e.path.join("."), message: e.message }))
          )
        )
      }
      next(err)
    }
  }
}
