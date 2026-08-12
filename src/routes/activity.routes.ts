import { Router } from "express"
import { activityController } from "../controllers/activity.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

router.get("/", authenticate, authorize("ADMIN", "MANAGER"), asyncHandler(activityController.list))

export default router
