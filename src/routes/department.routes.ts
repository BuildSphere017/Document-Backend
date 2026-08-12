import { Router } from "express"
import { departmentController } from "../controllers/department.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()
router.use(authenticate)

// Anyone authenticated can list departments (for dropdowns)
router.get("/", asyncHandler(departmentController.list))

// Admin only: create, update, delete
router.post("/", authorize("ADMIN"), asyncHandler(departmentController.create))
router.patch("/:id", authorize("ADMIN"), asyncHandler(departmentController.update))
router.delete("/:id", authorize("ADMIN"), asyncHandler(departmentController.remove))

export default router
