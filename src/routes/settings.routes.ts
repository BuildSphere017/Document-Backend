import { Router } from "express"
import { settingsController } from "../controllers/settings.controller.js"
import { authenticate } from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { updateProfileSchema, changePasswordSchema } from "../validation/settings.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()
router.use(authenticate)
router.get("/profile", asyncHandler(settingsController.profile))
router.patch("/profile", validate(updateProfileSchema), asyncHandler(settingsController.updateProfile))
router.post("/change-password", validate(changePasswordSchema), asyncHandler(settingsController.changePassword))
router.get("/system", asyncHandler(settingsController.system))
export default router
