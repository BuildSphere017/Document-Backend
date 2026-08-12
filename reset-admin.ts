/**
 * reset-admin.ts — force-reset the admin password.
 * Run with:  npx tsx reset-admin.ts
 * It sets the SEED_ADMIN_USERNAME account's password to SEED_ADMIN_PASSWORD (from .env),
 * re-enables it if disabled, and confirms the result.
 */
import "dotenv/config"
import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME || "rishabhjaini"
  const password = process.env.SEED_ADMIN_PASSWORD || "Makphalt@2026"

  const user = await prisma.user.findFirst({ where: { username } })
  if (!user) {
    console.error(`❌ No user found with username "${username}". Check SEED_ADMIN_USERNAME in .env.`)
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, status: "ACTIVE", deletedAt: null },
  })

  // Verify it worked
  const updated = await prisma.user.findUnique({ where: { id: user.id } })
  const ok = await bcrypt.compare(password, updated!.passwordHash)

  console.log("────────────────────────────────────────")
  console.log(ok ? "✅ SUCCESS — admin password reset" : "❌ Something went wrong")
  console.log(`   Username: ${username}`)
  console.log(`   Password: ${password}`)
  console.log(`   Status:   ${updated!.status}`)
  console.log("────────────────────────────────────────")
  await prisma.$disconnect()
  process.exit(0)
}

main().catch(async (e) => {
  console.error("❌ Error:", e.message)
  await prisma.$disconnect()
  process.exit(1)
})
