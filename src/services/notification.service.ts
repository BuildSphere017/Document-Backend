import { prisma } from "../config/prisma.js"

export const notificationService = {
  async list(userId: string) {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.notification.count({ where: { userId, read: false } }),
    ])
    return { items, unread }
  },
  async markRead(userId: string, id: string) {
    await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } })
    return { success: true }
  },
  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } })
    return { success: true }
  },
  async create(userId: string, title: string, body?: string, type = "info", link?: string) {
    return prisma.notification.create({ data: { userId, title, body, type, link } })
  },
}
