/**
 * keywords-to-tags.ts
 * 
 * Ye script tumhare existing document keywords ko Tags table mein copy karta hai.
 * Ek baar run karo — sab documents ke tags set ho jaayenge.
 * 
 * Run: npx tsx keywords-to-tags.ts
 */
import "dotenv/config"
import { PrismaClient } from "@prisma/client"

declare const process: {
  exit(code?: number): never
}

const prisma = new PrismaClient()

async function main() {
  console.log("🏷️  Keywords → Tags migration starting...\n")

  // Get all documents that have keywords
  const docs = await prisma.document.findMany({
    where: {
      deletedAt: null,
      keyword: { not: null },
    },
    select: { id: true, title: true, keyword: true },
  })

  console.log(`Found ${docs.length} documents with keywords\n`)

  let totalTags = 0
  let skipped = 0

  for (const doc of docs) {
    if (!doc.keyword?.trim()) { skipped++; continue }

    // Split comma-separated keywords
    const keywords = doc.keyword
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length >= 2)

    if (!keywords.length) { skipped++; continue }

    console.log(`📄 ${doc.title}`)
    console.log(`   Keywords: ${keywords.join(", ")}`)

    for (const name of keywords) {
      // Upsert tag (create if not exists)
      const tag = await prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {},
      })

      // Link tag to document (skip if already linked)
      await prisma.documentTag.upsert({
        where: { documentId_tagId: { documentId: doc.id, tagId: tag.id } },
        create: { documentId: doc.id, tagId: tag.id },
        update: {},
      })

      totalTags++
    }

    console.log(`   ✅ ${keywords.length} tag(s) set\n`)
  }

  console.log("────────────────────────────────")
  console.log(`✅ Done!`)
  console.log(`   Documents processed: ${docs.length - skipped}`)
  console.log(`   Documents skipped:   ${skipped} (no keywords)`)
  console.log(`   Total tags set:      ${totalTags}`)
  console.log("────────────────────────────────")
  console.log("\nNow open any document → click 🏷️ → your keywords will show as tags!")
}

main()
  .catch((e) => { console.error("❌ Error:", e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())