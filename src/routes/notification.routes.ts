import { Router } from "express"
import { notificationController } from "../controllers/notification.controller.js"
import { authenticate } from "../middleware/auth.middleware.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()
router.use(authenticate)
router.get("/", asyncHandler(notificationController.list))
router.post("/:id/read", asyncHandler(notificationController.markRead))
router.post("/read-all", asyncHandler(notificationController.markAllRead))
export default router
