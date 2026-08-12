import { Router } from "express"
import { userController } from "../controllers/user.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { createUserSchema, updateUserSchema, resetPasswordSchema } from "../validation/user.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

// All user-management is ADMIN-only
router.use(authenticate, authorize("ADMIN"))

router.get("/", asyncHandler(userController.list))
router.post("/", validate(createUserSchema), asyncHandler(userController.create))
router.patch("/:id", validate(updateUserSchema), asyncHandler(userController.update))
router.post("/:id/disable", asyncHandler(userController.disable))
router.post("/:id/enable", asyncHandler(userController.enable))
router.post("/:id/reset-password", validate(resetPasswordSchema), asyncHandler(userController.resetPassword))
router.delete("/:id", asyncHandler(userController.remove))

export default router
