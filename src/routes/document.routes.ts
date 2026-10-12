
import { Router } from "express"
import { documentController } from "../controllers/document.controller.js"
import {
  authenticate,
  authorize,
  authorizeDocumentUpload,
} from "../middleware/auth.middleware.js"
import { validate } from "../middleware/validate.middleware.js"
import { upload } from "../middleware/upload.middleware.js"
import {
  uploadDocumentSchema,
  listDocumentsSchema,
  createShareSchema,
} from "../validation/document.validation.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = Router()

router.use(authenticate)

// Anyone authenticated: view permitted documents and download
router.get(
  "/",
  validate(listDocumentsSchema, "query"),
  asyncHandler(documentController.list),
)

// ADMIN only: download active PDFs in a category as a ZIP
router.get(
  "/category/:categoryId/zip",
  authorize("ADMIN"),
  asyncHandler(documentController.downloadCategoryZip),
)

// Download a document
router.get(
  "/:id/download",
  asyncHandler(documentController.download),
)

router.post(
  "/:id/share",
  validate(createShareSchema),
  asyncHandler(documentController.share),
)

// ADMIN + CRM department: upload
router.post(
  "/",
  authorizeDocumentUpload,
  upload.single("file"),
  validate(uploadDocumentSchema),
  asyncHandler(documentController.upload),
)

// ADMIN + CRM department: bulk upload
router.post(
  "/bulk",
  authorizeDocumentUpload,
  upload.array("files", 20),
  asyncHandler(documentController.bulkUpload),
)

// ADMIN only
router.post(
  "/:id/reprocess",
  authorize("ADMIN"),
  asyncHandler(documentController.reprocess),
)

router.delete(
  "/:id",
  authorize("ADMIN"),
  asyncHandler(documentController.remove),
)

// Favorites
router.get(
  "/favorites/list",
  asyncHandler(documentController.listFavorites),
)

router.post(
  "/:id/favorite",
  asyncHandler(documentController.toggleFavorite),
)

// Tags
router.get(
  "/tags/list",
  asyncHandler(documentController.listTags),
)

router.put(
  "/:id/tags",
  asyncHandler(documentController.setTags),
)

// Pin (ADMIN only)
router.post(
  "/:id/pin",
  authorize("ADMIN"),
  asyncHandler(documentController.togglePin),
)

// Recent searches
router.get(
  "/searches/recent",
  asyncHandler(documentController.recentSearches),
)

router.delete(
  "/searches/clear",
  asyncHandler(documentController.clearSearches),
)

// Export: ADMIN + MANAGER
router.get(
  "/export/activity",
  authorize("ADMIN", "MANAGER"),
  asyncHandler(documentController.exportActivity),
)

router.get(
  "/export/documents",
  authorize("ADMIN", "MANAGER"),
  asyncHandler(documentController.exportDocuments),
)

// Export complete document inventory: ADMIN only
router.get(
  "/export/inventory",
  authorize("ADMIN"),
  asyncHandler(documentController.exportDocumentInventory),
)

export default router
