import { PrismaClient } from "@prisma/client"
import { env } from "./env.js"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: env.isProd ? ["error"] : ["warn", "error"] })

if (!env.isProd) globalForPrisma.prisma = prisma
