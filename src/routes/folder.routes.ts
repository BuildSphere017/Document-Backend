import { Router } from "express"

import { folderController } from "../controllers/folder.controller.js"

import { authenticate, authorize } from "../middleware/auth.middleware.js"

import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

// Any authenticated user can view folders
router.get(
  "/",
  authenticate,
  asyncHandler(folderController.list)
)

router.get(
  "/:id",
  authenticate,
  asyncHandler(folderController.getById)
)

// Only ADMIN can create folders
router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(folderController.create)
)

// Only ADMIN can rename folders
router.patch(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(folderController.rename)
)

// Only ADMIN can delete folders
router.delete(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(folderController.remove)
)

// Only ADMIN can move folders
router.patch(
  "/:id/move",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(folderController.move)
)

// Only ADMIN can move documents between folders
router.patch(
  "/documents/:documentId/move",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(folderController.moveDocument)
)

export default router