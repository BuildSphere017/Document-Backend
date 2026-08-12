import { Router } from "express"
import { authController } from "../controllers/auth.controller.js"
import { authenticate } from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { authLimiter } from "../middleware/rateLimit.middleware.js"
import { loginSchema } from "../validation/auth.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

router.post("/login", authLimiter, validate(loginSchema), asyncHandler(authController.login))
router.get("/me", authenticate, asyncHandler(authController.me))
router.post("/logout", authenticate, asyncHandler(authController.logout))

export default router
