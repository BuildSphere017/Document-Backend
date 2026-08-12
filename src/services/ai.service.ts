import { prisma } from "../config/prisma.js"
import { getAIProvider } from "../ai/ai.provider.js"
import { activityService } from "./activity.service.js"
import { ApiError } from "../utils/ApiError.js"
import type { Role } from "@prisma/client"

interface ChunkHit {
  chunkId: string
  documentId: string
  content: string
  page: number | null
  distance: number
  title: string
  fileName: string
  fileType: string
  categoryId: string | null
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * In-memory embedding cache — saves Gemini calls for repeated/similar queries.
 * Cleared automatically when it grows too large.
 */
const embedCache = new Map<string, number[]>()
const EMBED_CACHE_MAX = 500

async function embedCached(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase()
  const cached = embedCache.get(key)
  if (cached) {
    console.log(`[ai:embed] cache hit for "${key.slice(0, 40)}"`)
    return cached
  }
  const ai = getAIProvider()
  const [emb] = await ai.embed([text])
  if (emb?.length) {
    if (embedCache.size >= EMBED_CACHE_MAX) embedCache.clear()
    embedCache.set(key, emb)
  }
  return emb ?? []
}

/**
 * Detect "fetch" requests vs real questions.
 * Fetch = user wants a document ("give me the test report of X")
 * Question = user wants an answer ("what is the shelf life of X?")
 *
 * NOTE: fetch requests still go through semantic search when keyword match
 * finds nothing (e.g. "Global Test House" is in the document body, not title).
 */
function isFetchRequest(text: string): boolean {
  const q = text.trim().toLowerCase()
  if (/\b(what|how|why|when|where|which|explain|compare|difference|does|is|are|can|should|tell)\b/.test(q)) {
    return false
  }
  return /\b(give|show|get|find|fetch|send|share|open|download|need|want|bring|all|every|list)\b/.test(q)
    || /\b(report|datasheet|document|file|certificate|price list|specification|spec|brochure|catalogue|catalog)\b/.test(q)
}

/** Category IDs a SALES user may see; null = unrestricted (admin/manager). */
async function visibleCategoryIds(userId: string, role: Role): Promise<string[] | null> {
  if (role === "ADMIN" || role === "MANAGER") return null
  const perms = await prisma.permission.findMany({ where: { userId, canView: true }, select: { categoryId: true } })
  return perms.map((p) => p.categoryId)
}

/**
 * Cosine distance threshold.
 * 0 = identical, 2 = opposite. Good matches 0.0–0.45, weak/noise 0.5+.
 */
const MAX_DISTANCE = 0.55

/** Vector similarity search over document chunks. */
async function retrieve(query: string, userId: string, role: Role, limit = 12): Promise<ChunkHit[]> {
  const queryEmbedding = await embedCached(query)
  if (!queryEmbedding?.length) return []
  const vec = toVectorLiteral(queryEmbedding)
  const allowed = await visibleCategoryIds(userId, role)

  const rows = await prisma.$queryRawUnsafe<ChunkHit[]>(
    `
    SELECT c.id as "chunkId", c."documentId", c.content, c.page,
           (c.embedding <=> $1::vector) as distance,
           d.title, d."fileName", d."fileType"::text as "fileType", d."categoryId"
    FROM "DocumentChunk" c
    JOIN "Document" d ON d.id = c."documentId"
    WHERE d."deletedAt" IS NULL
      AND (c.embedding <=> $1::vector) < $3
      ${allowed === null ? "" : `AND d."categoryId" = ANY($4::text[])`}
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2
    `,
    vec, limit, MAX_DISTANCE,
    ...(allowed === null ? [] : [allowed.length ? allowed : ["__none__"]])
  )

  if (rows.length > 0) {
    console.log(`[ai:retrieve] query="${query}" top:`,
      rows.slice(0, 4).map(r => `${r.title} (${Number(r.distance).toFixed(3)})`).join(", "))
  } else {
    console.log(`[ai:retrieve] query="${query}" — no chunks within distance ${MAX_DISTANCE}`)
  }

  return rows
}

// Common words that appear in every document — not useful for matching.
const STOPWORDS = new Set([
  "test", "report", "reports", "of", "the", "a", "an", "for", "me", "give", "show",
  "get", "find", "fetch", "send", "share", "open", "download", "need", "want", "bring",
  "document", "documents", "file", "files", "datasheet", "data", "sheet", "certificate",
  "price", "list", "specification", "spec", "brochure", "catalogue", "catalog", "please",
  "mak", "makphalt", "and", "to", "is", "on", "in", "with", "product", "all", "every",
])

/** Extract the meaningful/specific words from a query. */
function specificWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

/**
 * Keyword match — searches title/keyword/filename for SPECIFIC words in the
 * query (ignoring "MAK", "test", "report", etc.). Scored by match count.
 */
async function keywordMatch(query: string, userId: string, role: Role) {
  const allowed = await visibleCategoryIds(userId, role)
  const words = specificWords(query)
  if (!words.length) return []

  const where: any = { deletedAt: null }
  if (allowed !== null) where.categoryId = { in: allowed.length ? allowed : ["__none__"] }

  const docs = await prisma.document.findMany({
    where,
    select: {
      id: true, title: true, fileName: true, keyword: true,
      fileType: true, description: true, summary: true,
    },
  })

  return docs
    .map((d) => {
      const haystack = [d.title, d.keyword ?? "", d.fileName].join(" ").toLowerCase()
      const matched = words.filter((w) => haystack.includes(w)).length
      return { doc: d, matched }
    })
    .filter((s) => s.matched > 0)
    .sort((a, b) => b.matched - a.matched)
    .map((s) => s.doc)
}

/**
 * Pull the best chunks for a set of document IDs.
 * Used when we know which documents we want but need their text for context.
 */
async function chunksForDocs(ids: string[], limitPerDoc = 3): Promise<ChunkHit[]> {
  if (!ids.length) return []
  return prisma.$queryRawUnsafe<ChunkHit[]>(
    `
    SELECT DISTINCT ON (c."documentId") c.id as "chunkId", c."documentId", c.content, c.page,
           0 as distance, d.title, d."fileName", d."fileType"::text as "fileType", d."categoryId"
    FROM "DocumentChunk" c
    JOIN "Document" d ON d.id = c."documentId"
    WHERE c."documentId" = ANY($1::text[])
    ORDER BY c."documentId", c."chunkIndex" ASC
    LIMIT $2
    `,
    ids, ids.length * limitPerDoc
  )
}

/** Deduplicate hits — best chunk per document. */
function dedupeByDoc(hits: ChunkHit[]): ChunkHit[] {
  const seen = new Set<string>()
  return hits.filter((h) => {
    if (seen.has(h.documentId)) return false
    seen.add(h.documentId)
    return true
  })
}

export const aiService = {

  /** Semantic search + keyword match → documents ranked by relevance. */
  async search(query: string, userId: string, role: Role, actorName: string) {
    if (!query.trim()) throw ApiError.badRequest("Enter a search query")

    const [hits, kw] = await Promise.all([
      retrieve(query, userId, role, 12),
      keywordMatch(query, userId, role),
    ])

    const byDoc = new Map<string, ChunkHit>()
    for (const h of hits) {
      const existing = byDoc.get(h.documentId)
      if (!existing || h.distance < existing.distance) byDoc.set(h.documentId, h)
    }

    const results: any[] = []
    const seen = new Set<string>()

    // Keyword matches first (always shown)
    for (const d of kw) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      const semantic = byDoc.get(d.id)
      results.push({
        documentId: d.id, title: d.title, fileName: d.fileName, fileType: d.fileType,
        matchedParagraph: semantic?.content.slice(0, 400) ?? d.summary?.slice(0, 400) ?? d.description?.slice(0, 400) ?? `Keyword match: ${d.keyword ?? d.title}`,
        confidence: semantic ? Math.max(0.85, 1 - semantic.distance / MAX_DISTANCE) : 1,
        matchType: "keyword",
      })
    }

    // Semantic matches (not already keyword-matched)
    for (const h of [...byDoc.values()].sort((a, b) => a.distance - b.distance)) {
      if (seen.has(h.documentId)) continue
      seen.add(h.documentId)
      results.push({
        documentId: h.documentId, title: h.title, fileName: h.fileName, fileType: h.fileType,
        matchedParagraph: h.content.slice(0, 400),
        confidence: Math.max(0, Math.min(1, 1 - h.distance / MAX_DISTANCE)),
        matchType: "semantic",
      })
    }

    const final = results.slice(0, 10)
    await activityService.log({ action: "AI_SEARCH", actorName, userId, meta: { query, results: final.length } })
    await prisma.searchHistory.create({ data: { userId, query, mode: "ai", results: final.length } }).catch(() => {})
    return { query, results: final }
  },

  /**
   * Grounded chat — finds documents by keyword OR semantic search, then:
   * - For fetch requests ("give me the test report of Global Test House"):
   *   uses Gemini to summarise what each found document says about the topic,
   *   and returns all matching documents with clickable links.
   * - For real questions ("what is the shelf life of X?"):
   *   answers from the retrieved chunks with citations.
   */
  async chat(question: string, userId: string, role: Role, actorName: string, documentId?: string) {
    if (!question.trim()) throw ApiError.badRequest("Enter a question")

    const fetchMode = isFetchRequest(question) && !documentId

    // ── STEP 1: Find relevant documents ──────────────────────────────
    // Always try keyword match first (fast, precise for product names).
    // Then semantic search (finds text mentioned inside documents).
    // Merge results — keyword matches first, then semantic.
    const [semanticHits, kwDocs] = await Promise.all([
      retrieve(question, userId, role, 16), // more results for "all documents" queries
      keywordMatch(question, userId, role),
    ])

    // Get chunks for keyword-matched docs (so we have content for summaries)
    const kwChunks = kwDocs.length
      ? await chunksForDocs(kwDocs.map((d) => d.id))
      : []

    // Merge: keyword chunks first, then semantic hits
    const kwDocIds = new Set(kwDocs.map((d) => d.id))
    const semanticOnly = semanticHits.filter((h) => !kwDocIds.has(h.documentId))
    const allHits = [...kwChunks, ...semanticOnly]

    // Scope to specific document if requested
    const hits = documentId ? allHits.filter((h) => h.documentId === documentId) : allHits

    // ── STEP 2: Nothing found → honest "not found" ───────────────────
    if (!hits.length) {
      return {
        answer: fetchMode
          ? "I couldn't find any documents matching that in your library. Make sure the document is uploaded, processed (status: Ready), and that the text inside it has been indexed."
          : "I couldn't find anything relevant in your documents. Try rephrasing your question, or make sure the relevant document has been uploaded and processed.",
        citations: [],
      }
    }

    // One entry per document (deduplicated)
    const uniqueHits = dedupeByDoc(hits)

    // ── STEP 3: Build citations (links for every matched document) ───
    const citations = uniqueHits.slice(0, 10).map((h, i) => ({
      ref: i + 1,
      documentId: h.documentId,
      title: h.title,
      page: h.page,
      snippet: h.content.slice(0, 240),
    }))

    // ── STEP 4: Generate answer using Gemini ─────────────────────────
    // For fetch requests mentioning a name found ONLY in document text
    // (like "Global Test House"), we always generate — so Gemini can
    // summarise what each document says about that entity.
    // For simple product-name fetches, we build the answer without Gemini
    // to save quota (only use Gemini when the content adds real value).
    const needsGeneration = fetchMode
      ? semanticHits.some((h) => !kwDocIds.has(h.documentId)) // semantic found something keyword didn't → content-based match, need summary
      : true // real questions always need generation

    let answer: string

    if (!needsGeneration) {
      // Simple fetch — keyword matched by title/name. Return list + stored summaries.
      const kwMeta = await prisma.document.findMany({
        where: { id: { in: uniqueHits.map((h) => h.documentId) } },
        select: { id: true, summary: true, description: true },
      })
      const summaryFor = (docId: string, title: string, content: string) => {
        const meta = kwMeta.find((m) => m.id === docId)
        const text = meta?.summary || meta?.description || content.slice(0, 200)
        return text ? `• **${title}** — ${text.trim()}` : `• **${title}**`
      }
      const lines = uniqueHits.map((h) => summaryFor(h.documentId, h.title, h.content)).join("\n\n")
      answer = uniqueHits.length === 1
        ? `Here's what I found:\n\n${lines}\n\nUse the link below to preview or download it.`
        : `I found ${uniqueHits.length} matching document${uniqueHits.length > 1 ? "s" : ""}:\n\n${lines}\n\nUse the links below to open them.`
    } else {
      // Content-based match or real question → Gemini reads and answers.
      const context = hits.slice(0, 12)
        .map((h, i) => `[${i + 1}] (Document: "${h.title}"${h.page ? `, page ${h.page}` : ""})\n${h.content}`)
        .join("\n\n")

      const systemPrompt = fetchMode
        ? `You are a document assistant for the MAKPHALT sales team.
The user is looking for documents related to a specific topic, lab, or entity.
For each document found in the context, write a brief summary (1-2 sentences) of what it says about the topic.
Format your response as a list:
• Document Title — [brief summary of what this document says about the topic]
Always end with: "Use the links below to preview or download each document."
Never make up information. Only use what's in the context.`
        : `You are a document assistant for the MAKPHALT sales team.
Answer ONLY using the provided context. Never guess or use outside knowledge.
Be concise and factual. Cite sources inline like [1], [2].
If the answer isn't in the context, say you don't have that information.`

      try {
        answer = await getAIProvider().chat(systemPrompt, `Context:\n${context}\n\nUser request: ${question}`)
      } catch (err: any) {
        if (err?.response?.status === 429) {
          // Fallback: return document links even if Gemini is rate-limited
          const names = uniqueHits.slice(0, 5).map((h) => `• ${h.title}`).join("\n")
          return {
            answer: `I found ${uniqueHits.length} matching document${uniqueHits.length > 1 ? "s" : ""}:\n\n${names}\n\nUse the links below to open them. (AI summary unavailable — rate limit reached, try again in a minute.)`,
            citations,
          }
        }
        throw err
      }
    }

    await activityService.log({ action: "AI_SEARCH", actorName, userId, meta: { question, mode: fetchMode ? "fetch" : "chat" } })
    return { answer: answer.trim(), citations }
  },
}