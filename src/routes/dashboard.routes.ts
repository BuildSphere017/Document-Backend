import { Router } from "express"
import { dashboardController } from "../controllers/dashboard.controller.js"
import { authenticate } from "../middleware/auth.middleware.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

router.get("/overview", authenticate, asyncHandler(dashboardController.overview))

export default router
