import { prisma } from "../config/prisma.js"
import { env } from "../config/env.js"
import type { Role } from "@prisma/client"

const CATEGORY_PALETTE = ["#2563EB", "#F97316", "#10B981", "#8B5CF6", "#0EA5E9", "#EF4444", "#EAB308"]

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    console.log(`[Dashboard] ${name}: ${Date.now() - start}ms`)
  }
}

async function visibleCategoryFilter(userId: string, role: Role) {
  if (role === "ADMIN" || role === "MANAGER") return {}

  const perms = await prisma.permission.findMany({
    where: { userId, canView: true },
    select: { categoryId: true },
  })

  return { categoryId: { in: perms.map((p) => p.categoryId) } }
}

export const dashboardService = {
  async overview(userId: string, role: Role) {
    const totalStart = Date.now()

    const today = startOfToday()
    const fourteenDaysAgo = new Date(today)
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13)

    const catFilter = await timed(
      "permissions",
      () => visibleCategoryFilter(userId, role),
    )

    const docWhere = { deletedAt: null, ...catFilter }

    const [
      totalDocuments,
      totalCategories,
      totalUsers,
      uploadsToday,
      downloadsToday,
      aiSearchesToday,
      storageAgg,
      docsByCategory,
      recentUploads,
      mostViewed,
      recentActivity,
      activeUsersToday,
      trendDocs,
      categories,
    ] = await Promise.all([
      timed("totalDocuments", () =>
        prisma.document.count({ where: docWhere }),
      ),

      timed("totalCategories", () =>
        prisma.category.count({
          where: { deletedAt: null, archived: false },
        }),
      ),

      timed("totalUsers", () =>
        prisma.user.count({
          where: { deletedAt: null },
        }),
      ),

      timed("uploadsToday", () =>
        prisma.document.count({
          where: { ...docWhere, createdAt: { gte: today } },
        }),
      ),

      timed("downloadsToday", () =>
        prisma.activityLog.count({
          where: {
            action: "DOWNLOAD",
            createdAt: { gte: today },
          },
        }),
      ),

      timed("aiSearchesToday", () =>
        prisma.activityLog.count({
          where: {
            action: "AI_SEARCH",
            createdAt: { gte: today },
          },
        }),
      ),

      timed("storageAgg", () =>
        prisma.document.aggregate({
          where: docWhere,
          _sum: { size: true },
        }),
      ),

      timed("docsByCategory", () =>
        prisma.document.groupBy({
          by: ["categoryId"],
          where: docWhere,
          _count: { _all: true },
        }),
      ),

      timed("recentUploads", () =>
        prisma.document.findMany({
          where: docWhere,
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            title: true,
            fileName: true,
            fileType: true,
            size: true,
            createdAt: true,
            viewCount: true,
            category: {
              select: { id: true, name: true, color: true },
            },
            uploadedBy: {
              select: { id: true, fullName: true },
            },
          },
        }),
      ),

      timed("mostViewed", () =>
        prisma.document.findMany({
          where: docWhere,
          orderBy: { viewCount: "desc" },
          take: 6,
          select: {
            id: true,
            title: true,
            fileName: true,
            fileType: true,
            size: true,
            createdAt: true,
            viewCount: true,
            category: {
              select: { id: true, name: true, color: true },
            },
          },
        }),
      ),

      timed("recentActivity", () =>
        prisma.activityLog.findMany({
          where: role === "SALES" ? { userId } : undefined,
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
      ),

      timed("activeUsersToday", () =>
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT "userId") AS count
          FROM "ActivityLog"
          WHERE "createdAt" >= ${today}
          AND "userId" IS NOT NULL
        `.then((r) => Number(r[0]?.count ?? 0)),
      ),

      timed("storageTrend", () =>
        prisma.document.findMany({
          where: {
            ...docWhere,
            createdAt: { gte: fourteenDaysAgo },
          },
          select: { size: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        }),
      ),

      timed("categories", () =>
        prisma.category.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, color: true },
        }),
      ),
    ])

    const catMap = new Map(categories.map((c) => [c.id, c]))

    const categoryDistribution = docsByCategory
      .filter((g) => g.categoryId)
      .map((g, i) => {
        const cat = catMap.get(g.categoryId!)

        return {
          name: cat?.name ?? "Uncategorized",
          value: g._count._all,
          color: cat?.color ?? CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
        }
      })
      .sort((a, b) => b.value - a.value)

    const byDay = new Map<string, number>()

    for (const d of trendDocs) {
      const key = d.createdAt.toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) ?? 0) + Number(d.size))
    }

    const storageTrend: { date: string; bytes: number }[] = []
    let cumulative = 0

    for (let i = 13; i >= 0; i--) {
      const day = new Date(today)
      day.setDate(day.getDate() - i)

      const key = day.toISOString().slice(0, 10)

      cumulative += byDay.get(key) ?? 0

      storageTrend.push({
        date: day.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        bytes: cumulative,
      })
    }

    console.log(`[Dashboard] TOTAL: ${Date.now() - totalStart}ms`)

    return {
      stats: {
        storageUsed: Number(storageAgg._sum.size ?? 0),
        storageLimit: env.storageLimitGb * 1024 * 1024 * 1024,
        totalDocuments,
        totalCategories,
        totalUsers,
        uploadsToday,
        downloadsToday,
        aiSearchesToday,
        activeUsersToday,
      },
      categoryDistribution,
      storageTrend,
      recentUploads,
      mostViewed,
      recentActivity,
      provider: env.ai.provider,
    }
  },
}