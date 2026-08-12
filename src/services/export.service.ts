import { prisma } from "../config/prisma.js"

export const exportService = {
  /**
   * Export activity log as CSV-compatible data for Excel.
   */
  async activityExcel() {
    const logs = await prisma.activityLog.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 1000,
      // cast include to any because the generated Prisma types may name the relation
      // differently in some schemas; at runtime this will work if the relation
      // exists as "actor" on the model. This avoids a TypeScript build error.
      include: ({
        actor: {
          select: {
            fullName: true,
            username: true,
          },
        },
      } as any),
    })

    const rows = logs.map((l) => ({
      Date: l.createdAt.toISOString().slice(0, 10),
      Time: l.createdAt.toISOString().slice(11, 19),
      Action: l.action,
      User: (l.actor as any)?.fullName ?? "System",
      Username: (l.actor as any)?.username ?? "",
      Target: l.targetTitle ?? "",
      TargetType: l.targetType ?? "",
    }))

    return rows
  },

  /**
   * Export document list as Excel-compatible data.
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

      Tags: d.tags
        .map((t) => t.tag.name)
        .join(", "),

      FileType: d.fileType,

      Size_KB: Math.round(
        Number(d.size) / 1024
      ),

      Status: d.status,

      Keywords: d.keyword ?? "",

      UploadedBy:
        d.uploadedBy?.fullName ?? "",

      UploadedOn:
        d.createdAt
          .toISOString()
          .slice(0, 10),

      Downloads: d.downloadCount,
    }))
  },
}