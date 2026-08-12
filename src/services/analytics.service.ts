import { prisma } from "../config/prisma.js"

const PALETTE = ["#2563EB", "#F97316", "#10B981", "#8B5CF6", "#0EA5E9", "#EF4444", "#EAB308", "#EC4899"]

export const analyticsService = {
  async overview() {
    const now = new Date()
    const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

    const [
      totalDocuments, totalUsers, totalCategories, storageAgg,
      mostViewed, mostDownloaded, docsByCategory, categories,
      actionCounts, inactiveDocs, topUploaders,
    ] = await Promise.all([
      prisma.document.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.category.count({ where: { deletedAt: null, archived: false } }),
      prisma.document.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
      prisma.document.findMany({
        where: { deletedAt: null }, orderBy: { viewCount: "desc" }, take: 8,
        include: { category: true },
      }),
      prisma.document.findMany({
        where: { deletedAt: null }, orderBy: { downloadCount: "desc" }, take: 8,
        include: { category: true },
      }),
      prisma.document.groupBy({ by: ["categoryId"], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.category.findMany({ where: { deletedAt: null } }),
      prisma.activityLog.groupBy({ by: ["action"], _count: { _all: true }, where: { createdAt: { gte: since30 } } }),
      prisma.document.findMany({
        where: { deletedAt: null, downloadCount: 0, viewCount: 0 },
        orderBy: { createdAt: "asc" }, take: 8, include: { category: true },
      }),
      prisma.document.groupBy({ by: ["uploadedById"], where: { deletedAt: null }, _count: { _all: true } }),
    ])

    const catMap = new Map<string, (typeof categories)[number]>(categories.map((c) => [c.id, c]))
    const categoryUsage = docsByCategory
      .filter((g) => g.categoryId)
      .map((g, i) => ({
        name: catMap.get(g.categoryId!)?.name ?? "Uncategorized",
        value: g._count._all,
        color: catMap.get(g.categoryId!)?.color ?? PALETTE[i % PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)

    // activity over last 14 days
    const logs = await prisma.activityLog.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - 14 * 24 * 3600 * 1000) } },
      select: { action: true, createdAt: true },
    })
    const byDay = new Map<string, { uploads: number; downloads: number; ai: number }>()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000)
      byDay.set(d.toISOString().slice(0, 10), { uploads: 0, downloads: 0, ai: 0 })
    }
    for (const l of logs) {
      const key = l.createdAt.toISOString().slice(0, 10)
      const row = byDay.get(key)
      if (!row) continue
      if (l.action === "UPLOAD") row.uploads++
      else if (l.action === "DOWNLOAD") row.downloads++
      else if (l.action === "AI_SEARCH") row.ai++
    }
    const activityTrend = [...byDay.entries()].map(([date, v]) => ({
      date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ...v,
    }))

    // resolve uploader names
    const uploaderIds = topUploaders.map((u) => u.uploadedById)
    const uploaders = await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, fullName: true } })
    const uploaderMap = new Map(uploaders.map((u) => [u.id, u.fullName]))
    const topContributors = topUploaders
      .map((u) => ({ name: uploaderMap.get(u.uploadedById) ?? "Unknown", value: u._count._all }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    const actions = Object.fromEntries(actionCounts.map((a) => [a.action, a._count._all]))

    return {
      totals: {
        documents: totalDocuments,
        users: totalUsers,
        categories: totalCategories,
        storageUsed: Number(storageAgg._sum.size ?? 0),
        downloads30d: actions["DOWNLOAD"] ?? 0,
        aiSearches30d: actions["AI_SEARCH"] ?? 0,
        shares30d: actions["SHARE"] ?? 0,
      },
      mostViewed: mostViewed.map((d) => ({ id: d.id, title: d.title, count: d.viewCount, category: d.category?.name })),
      mostDownloaded: mostDownloaded.map((d) => ({ id: d.id, title: d.title, count: d.downloadCount, category: d.category?.name })),
      categoryUsage,
      activityTrend,
      inactive: inactiveDocs.map((d) => ({ id: d.id, title: d.title, category: d.category?.name, createdAt: d.createdAt })),
      topContributors,
    }
  },
}
