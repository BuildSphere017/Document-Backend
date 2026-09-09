import { Router } from "express"

import authRoutes from "./auth.routes.js"

import dashboardRoutes from "./dashboard.routes.js"

import userRoutes from "./user.routes.js"

import categoryRoutes from "./category.routes.js"

import folderRoutes from "./folder.routes.js"

import documentRoutes from "./document.routes.js"

import aiRoutes from "./ai.routes.js"

import analyticsRoutes from "./analytics.routes.js"

import notificationRoutes from "./notification.routes.js"

import settingsRoutes from "./settings.routes.js"

import activityRoutes from "./activity.routes.js"

import departmentRoutes from "./department.routes.js"

const router = Router()

router.get("/health", (_req, res) =>
  res.json({ status: "ok", ts: new Date().toISOString() })
)

router.use("/auth", authRoutes)

router.use("/dashboard", dashboardRoutes)

router.use("/users", userRoutes)

router.use("/categories", categoryRoutes)

router.use("/folders", folderRoutes)

router.use("/documents", documentRoutes)

router.use("/ai", aiRoutes)

router.use("/analytics", analyticsRoutes)

router.use("/notifications", notificationRoutes)

router.use("/settings", settingsRoutes)

router.use("/activity", activityRoutes)

router.use("/departments", departmentRoutes)

export default router