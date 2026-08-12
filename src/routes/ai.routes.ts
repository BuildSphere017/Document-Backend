import { Router } from "express"
import { aiController } from "../controllers/ai.controller.js"
import { authenticate } from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { aiSearchSchema, aiChatSchema } from "../validation/ai.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()
router.use(authenticate)

router.post("/search", validate(aiSearchSchema), asyncHandler(aiController.search))
router.post("/chat", validate(aiChatSchema), asyncHandler(aiController.chat))

export default router
