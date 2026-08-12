import { Router } from "express"
import { categoryController } from "../controllers/category.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { createCategorySchema, updateCategorySchema } from "../validation/category.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

// Any authenticated user can read categories (needed for upload forms / filters)
router.get("/", authenticate, asyncHandler(categoryController.list))

// Mutations are restricted to ADMIN / MANAGER
router.post("/", authenticate, authorize("ADMIN", "MANAGER"), validate(createCategorySchema), asyncHandler(categoryController.create))
router.patch("/:id", authenticate, authorize("ADMIN", "MANAGER"), validate(updateCategorySchema), asyncHandler(categoryController.update))
router.delete("/:id", authenticate, authorize("ADMIN", "MANAGER"), asyncHandler(categoryController.remove))

export default router
