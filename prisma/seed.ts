import { PrismaClient, Role } from "@prisma/client"
import bcrypt from "bcryptjs"
import "dotenv/config"

const prisma = new PrismaClient()

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

async function main() {
  console.log("→ Seeding database…")

  // 1) Seed admin
  const {
    SEED_ADMIN_NAME = "Rishabh Jaini",
    SEED_ADMIN_USERNAME = "rishabh",
    SEED_ADMIN_EMAIL = "admin@makphalt.com",
    SEED_ADMIN_PASSWORD = "ChangeMe123!",
  } = process.env

  const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 12)

  const admin = await prisma.user.upsert({
    where: { username: SEED_ADMIN_USERNAME },
    update: {},
    create: {
      fullName: SEED_ADMIN_NAME,
      username: SEED_ADMIN_USERNAME,
      email: SEED_ADMIN_EMAIL,
      passwordHash,
      role: Role.ADMIN,
      department: "Management",
    },
  })
  console.log(`  ✓ Admin ready: ${admin.username}`)

  // 2) Default categories (from the original app)
  const categories = [
    { name: "Certifications", color: "#2563EB" },
    { name: "Marketing Material", color: "#F97316" },
    { name: "Price Lists", color: "#10B981" },
    { name: "Product Datasheets", color: "#8B5CF6" },
    { name: "Technical Specifications", color: "#0EA5E9" },
  ]

  for (const [i, c] of categories.entries()) {
    await prisma.category.upsert({
      where: { name: c.name },
      update: {},
      create: { name: c.name, slug: slugify(c.name), color: c.color, sortOrder: i },
    })
  }
  console.log(`  ✓ ${categories.length} categories ready`)

  // 3) Sample sales user
  const salesHash = await bcrypt.hash("Sales123!", 12)
  const sales = await prisma.user.upsert({
    where: { username: "arunjoshi" },
    update: {},
    create: {
      fullName: "Arun Joshi",
      username: "arunjoshi",
      email: "arunjoshi@makphalt.com",
      passwordHash: salesHash,
      role: Role.SALES,
      department: "Sales",
    },
  })

  // Grant the sales user view access to all categories
  const allCats = await prisma.category.findMany()
  for (const cat of allCats) {
    await prisma.permission.upsert({
      where: { userId_categoryId: { userId: sales.id, categoryId: cat.id } },
      update: {},
      create: { userId: sales.id, categoryId: cat.id, canView: true },
    })
  }
  console.log(`  ✓ Sample sales user ready: ${sales.username}`)

  console.log("✅ Seed complete.")
  console.log(`\n   Login as admin → username: ${SEED_ADMIN_USERNAME}  password: ${SEED_ADMIN_PASSWORD}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
