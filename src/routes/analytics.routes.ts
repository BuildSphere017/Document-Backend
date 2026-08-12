import { Router } from "express"
import { analyticsController } from "../controllers/analytics.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()
router.get("/overview", authenticate, authorize("ADMIN", "MANAGER"), asyncHandler(analyticsController.overview))
export default router
