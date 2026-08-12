import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { prisma } from "./config/prisma.js"

async function bootstrap() {
  const app = createApp()

  // Verify DB connectivity before accepting traffic
  try {
    await prisma.$connect()
    console.log("✓ Database connected")
  } catch (err) {
    console.error("✗ Database connection failed:", err)
    process.exit(1)
  }

  const server = app.listen(env.port, () => {
    console.log(`\n🚀 MAKPHALT DMS API running`)
    console.log(`   → http://localhost:${env.port}/api`)
    console.log(`   → env: ${env.nodeEnv}  |  AI provider: ${env.ai.provider}`)
    console.log(`   → storage: ${env.supabase.enabled ? "Supabase" : "NOT CONFIGURED"}\n`)
  })

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully…`)
    server.close(async () => {
      await prisma.$disconnect()
      process.exit(0)
    })
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}

bootstrap().catch((err) => {
  console.error("Fatal bootstrap error:", err)
  process.exit(1)
})
