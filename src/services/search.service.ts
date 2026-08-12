import { prisma } from "../config/prisma.js"

export const searchService = {
  /** Get recent searches for a user (last 10, distinct queries). */
  async recent(userId: string) {
    const rows = await prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    })
    // Deduplicate by query (keep most recent per query)
    const seen = new Set<string>()
    return rows
      .filter((r) => { if (seen.has(r.query)) return false; seen.add(r.query); return true })
      .slice(0, 10)
      .map((r) => ({ id: r.id, query: r.query, mode: r.mode, results: r.results, createdAt: r.createdAt }))
  },

  /** Clear all search history for a user. */
  async clear(userId: string) {
    await prisma.searchHistory.deleteMany({ where: { userId } })
    return { success: true }
  },
}
