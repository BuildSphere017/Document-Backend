import { prisma } from "../config/prisma.js"
import { env } from "../config/env.js"
import type { Role } from "@prisma/client"

const CATEGORY_PALETTE = ["#2563EB", "#F97316", "#10B981", "#8B5CF6", "#0EA5E9", "#EF4444", "#EAB308"]

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Documents visible to a given user (SALES limited to permitted categories). */
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
    const today = startOfToday()
    const catFilter = await visibleCategoryFilter(userId, role)
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
    ] = await Promise.all([
      prisma.document.count({ where: docWhere }),
      prisma.category.count({ where: { deletedAt: null, archived: false } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.document.count({ where: { ...docWhere, createdAt: { gte: today } } }),
      prisma.activityLog.count({ where: { action: "DOWNLOAD", createdAt: { gte: today } } }),
      prisma.activityLog.count({ where: { action: "AI_SEARCH", createdAt: { gte: today } } }),
      prisma.document.aggregate({ where: docWhere, _sum: { size: true } }),
      prisma.document.groupBy({
        by: ["categoryId"],
        where: docWhere,
        _count: { _all: true },
      }),
      prisma.document.findMany({
        where: docWhere,
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { category: true, uploadedBy: { select: { id: true, fullName: true } } },
      }),
      prisma.document.findMany({
        where: docWhere,
        orderBy: { viewCount: "desc" },
        take: 6,
        include: { category: true },
      }),
      prisma.activityLog.findMany({
        where: role === "SALES" ? { userId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      // Active users today — count distinct users who did anything today
      prisma.$queryRaw<[{count: bigint}]>`
        SELECT COUNT(DISTINCT "userId") as count
        FROM "ActivityLog"
        WHERE "createdAt" >= ${today}
        AND "userId" IS NOT NULL
      `.then((r) => Number(r[0]?.count ?? 0)),
    ])

    // Category distribution with names + colors
    const categories = await prisma.category.findMany({ where: { deletedAt: null } })
    const catMap = new Map<string, (typeof categories)[number]>(categories.map((c) => [c.id, c]))
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

    // Storage trend: cumulative bytes by day over the last 14 days
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 14)
    const docs = await prisma.document.findMany({
      where: { ...docWhere, createdAt: { gte: thirtyDaysAgo } },
      select: { size: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    })
    const trend: { date: string; bytes: number }[] = []
    let cumulative = 0
    const byDay = new Map<string, number>()
    for (const d of docs) {
      const key = d.createdAt.toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) ?? 0) + Number(d.size))
    }
    const days = 14
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      const key = day.toISOString().slice(0, 10)
      cumulative += byDay.get(key) ?? 0
      trend.push({ date: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }), bytes: cumulative })
    }

    const storageUsed = Number(storageAgg._sum.size ?? 0)

    return {
      stats: {
        storageUsed,
        storageLimit: env.storageLimitGb * 1024 * 1024 * 1024, // from STORAGE_LIMIT_GB (default 1GB = Supabase free tier)
        totalDocuments,
        totalCategories,
        totalUsers,
        uploadsToday,
        downloadsToday,
        aiSearchesToday,
        activeUsersToday,
      },
      categoryDistribution,
      storageTrend: trend,
      recentUploads,
      mostViewed,
      recentActivity,
      provider: env.ai.provider,
    }
  },
}