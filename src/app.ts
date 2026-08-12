import express from "express"
import cors from "cors"
import helmet from "helmet"
import compression from "compression"
import morgan from "morgan"
import cookieParser from "cookie-parser"
import { env } from "./config/env.js"
import routes from "./routes/index.js"
import { globalLimiter } from "./middleware/rateLimit.middleware.js"
import { notFoundHandler, errorHandler } from "./middleware/error.middleware.js"

export function createApp() {
  const app = express()

  app.set("trust proxy", 1)

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    })
  )
  app.use(compression())
  app.use(express.json({ limit: "2mb" }))
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())
  if (!env.isProd) app.use(morgan("dev"))

  app.use("/api", globalLimiter, routes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
