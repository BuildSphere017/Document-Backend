import * as XLSX from "xlsx"
import { prisma } from "../config/prisma.js"

export const exportService = {
  /**
   * Export activity log as rows compatible with Excel.
   */
  async activityExcel() {
    const logs = await prisma.activityLog.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 1000,
      include: ({
        actor: {
          select: {
            fullName: true,
            username: true,
          },
        },
      } as any),
    })

    return logs.map((l) => ({
      Date: l.createdAt.toISOString().slice(0, 10),
      Time: l.createdAt.toISOString().slice(11, 19),
      Action: l.action,
      User: (l.actor as any)?.fullName ?? "System",
      Username: (l.actor as any)?.username ?? "",
      Target: l.targetTitle ?? "",
      TargetType: l.targetType ?? "",
    }))
  },

  /**
   * Existing document export. Keep its current columns.
   */
  async documentsExcel() {
    const docs = await prisma.document.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        category: true,
        uploadedBy: {
          select: {
            fullName: true,
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    })

    return docs.map((d) => ({
      Title: d.title,
      Category: d.category?.name ?? "",
      Tags: d.tags.map((t) => t.tag.name).join(", "),
      FileType: d.fileType,
      Size_KB: Math.round(Number(d.size) / 1024),
      Status: d.status,
      Keywords: d.keyword ?? "",
      UploadedBy: d.uploadedBy?.fullName ?? "",
      UploadedOn: d.createdAt.toISOString().slice(0, 10),
      Downloads: d.downloadCount,
    }))
  },

  /**
   * Build a real XLSX workbook containing all active documents.
   */
  async documentInventoryExcel() {
    const [docs, folders] = await Promise.all([
      prisma.document.findMany({
        where: {
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          fileName: true,
          category: {
            select: {
              name: true,
            },
          },
          folderId: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),

      prisma.folder.findMany({
        where: {
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      }),
    ])

    const folderById = new Map(
      folders.map((folder) => [folder.id, folder]),
    )

    function getFolderPath(folderId: string | null): string {
      const segments: string[] = []
      const visited = new Set<string>()
      let currentId = folderId

      while (currentId) {
        if (visited.has(currentId)) {
          break
        }

        visited.add(currentId)

        const folder = folderById.get(currentId)

        if (!folder) {
          break
        }

        segments.unshift(folder.name)
        currentId = folder.parentId
      }

      return segments.join("/")
    }

    const rows = docs.map((doc) => ({
      "Product Name": doc.title,
      "Category Name": doc.category?.name ?? "",
      "Folder Path": getFolderPath(doc.folderId),
      "Document Name": doc.fileName,
      "Document ID": doc.id,
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: [
        "Product Name",
        "Category Name",
        "Folder Path",
        "Document Name",
        "Document ID",
      ],
    })

    worksheet["!cols"] = [
      { wch: 30 },
      { wch: 25 },
      { wch: 45 },
      { wch: 40 },
      { wch: 30 },
    ]

    const workbook = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Document Inventory",
    )

    return XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    })
  },
}