import { Router } from "express"
import { documentController } from "../controllers/document.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { upload } from "../middleware/upload.middleware.js"
import {
  uploadDocumentSchema, listDocumentsSchema, createShareSchema,
} from "../validation/document.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

router.use(authenticate)

// Anyone authenticated: view (scoped to permitted categories) + download
router.get("/", validate(listDocumentsSchema, "query"), asyncHandler(documentController.list))
router.get("/:id/download", asyncHandler(documentController.download))
router.post("/:id/share", validate(createShareSchema), asyncHandler(documentController.share))

// ADMIN only: upload + delete
router.post(
  "/",
  authorize("ADMIN"),
  upload.single("file"),
  validate(uploadDocumentSchema),
  asyncHandler(documentController.upload)
)
router.post(
  "/bulk",
  authorize("ADMIN"),
  upload.array("files", 20),
  asyncHandler(documentController.bulkUpload)
)
router.post("/:id/reprocess", authorize("ADMIN"), asyncHandler(documentController.reprocess))
router.delete("/:id", authorize("ADMIN"), asyncHandler(documentController.remove))

// Favorites (any authenticated user)
router.get("/favorites/list", asyncHandler(documentController.listFavorites))
router.post("/:id/favorite", asyncHandler(documentController.toggleFavorite))

// Tags
router.get("/tags/list", asyncHandler(documentController.listTags))
router.put("/:id/tags", asyncHandler(documentController.setTags))

// Pin (admin only)
router.post("/:id/pin", authorize("ADMIN"), asyncHandler(documentController.togglePin))

// Recent searches
router.get("/searches/recent", asyncHandler(documentController.recentSearches))
router.delete("/searches/clear", asyncHandler(documentController.clearSearches))

// Export
router.get("/export/activity", authorize("ADMIN", "MANAGER"), asyncHandler(documentController.exportActivity))
router.get("/export/documents", authorize("ADMIN", "MANAGER"), asyncHandler(documentController.exportDocuments))

export default router
