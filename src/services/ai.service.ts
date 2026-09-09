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

interface DocumentCandidate {
  id: string
  title: string
  fileName: string
  keyword: string | null
  fileType: string
  description: string | null
  summary: string | null
  extractedText: string | null
  score: number
  matchedTerms: string[]
  phraseMatches: string[]
}

interface AIResult {
  documentId: string
  title: string
  fileName: string
  fileType: string
  matchedParagraph: string
  confidence: number
  matchType: string
}

const MAX_DISTANCE = 0.55

/**
 * Convert embedding array into pgvector format.
 */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * Embedding cache.
 *
 * Prevents repeated embedding calls for the same search question.
 */
const embedCache = new Map<string, number[]>()

const EMBED_CACHE_MAX = 500

async function embedCached(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase()

  const cached = embedCache.get(key)

  if (cached) {
    console.log(
      `[ai:embed] cache hit for "${key.slice(0, 80)}"`
    )

    return cached
  }

  const ai = getAIProvider()

  const [embedding] = await ai.embed([text])

  if (embedding && embedding.length > 0) {
    if (embedCache.size >= EMBED_CACHE_MAX) {
      embedCache.clear()
    }

    embedCache.set(key, embedding)
  }

  return embedding ?? []
}

/**
 * Detect whether the user is requesting
 * an actual document/file.
 *
 * This is intentionally generic.
 *
 * We do NOT maintain a hardcoded list of
 * company document categories here.
 */
function isFetchRequest(text: string): boolean {
  const q = text.trim().toLowerCase()

  /*
   * Normal questions should be answered
   * from document content.
   */
  if (
    /^(what|how|why|when|where|which|does|is|are|can|should)\b/.test(
      q
    )
  ) {
    /*
     * "What documents do we have..."
     * is still a document search.
     */
    if (/^(what|which)\s+(documents?|files?)\b/.test(q)) {
      return true
    }

    return false
  }

  /*
   * Generic retrieval language.
   */
  return (
    /\b(give|show|get|find|fetch|send|share|open|download|need|want|bring|list)\b/.test(
      q
    ) ||
    /\b(report|document|file|certificate|datasheet|brochure|catalogue|catalog|specification|approval|invoice|quotation|purchase|order|warranty|manual|letter|form|statement|record|policy|agreement|contract)\b/.test(
      q
    )
  )
}

/**
 * Return categories visible to the user.
 *
 * ADMIN and MANAGER have unrestricted access.
 */
async function visibleCategoryIds(
  userId: string,
  role: Role
): Promise<string[] | null> {
  if (role === "ADMIN" || role === "MANAGER") {
    return null
  }

  const permissions = await prisma.permission.findMany({
    where: {
      userId,
      canView: true,
    },
    select: {
      categoryId: true,
    },
  })

  return permissions.map(
    (permission) => permission.categoryId
  )
}

/**
 * Semantic vector search.
 */
async function retrieve(
  query: string,
  userId: string,
  role: Role,
  limit = 16
): Promise<ChunkHit[]> {
  const embedding = await embedCached(query)

  if (!embedding || embedding.length === 0) {
    return []
  }

  const vector = toVectorLiteral(embedding)

  const allowed = await visibleCategoryIds(
    userId,
    role
  )

  const permissionCondition =
    allowed === null
      ? ""
      : `AND d."categoryId" = ANY($4::text[])`

  const params: any[] = [
    vector,
    limit,
    MAX_DISTANCE,
  ]

  if (allowed !== null) {
    params.push(
      allowed.length
        ? allowed
        : ["__none__"]
    )
  }

  const rows =
    await prisma.$queryRawUnsafe<ChunkHit[]>(
      `
      SELECT
        c.id AS "chunkId",
        c."documentId",
        c.content,
        c.page,
        (c.embedding <=> $1::vector) AS distance,
        d.title,
        d."fileName",
        d."fileType"::text AS "fileType",
        d."categoryId"
      FROM "DocumentChunk" c
      INNER JOIN "Document" d
        ON d.id = c."documentId"
      WHERE
        d."deletedAt" IS NULL
        AND d.status = 'READY'
        AND c.embedding IS NOT NULL
        AND (c.embedding <=> $1::vector) < $3
        ${permissionCondition}
      ORDER BY
        c.embedding <=> $1::vector
      LIMIT $2
      `,
      ...params
    )

  if (rows.length) {
    console.log(
      `[ai:retrieve] "${query}" =>`,
      rows
        .slice(0, 6)
        .map(
          (row) =>
            `${row.title} (${Number(
              row.distance
            ).toFixed(3)})`
        )
        .join(", ")
    )
  } else {
    console.log(
      `[ai:retrieve] "${query}" => no semantic matches`
    )
  }

  return rows
}

/**
 * Words that describe the user's request,
 * rather than the actual document subject.
 *
 * IMPORTANT:
 *
 * We intentionally keep meaningful words such as:
 *
 * test
 * report
 * certificate
 * approval
 * inspection
 * warranty
 * etc.
 */
const STOPWORDS = new Set([
  "give",
  "show",
  "get",
  "find",
  "fetch",
  "send",
  "share",
  "open",
  "download",
  "need",
  "want",
  "bring",
  "please",

  "me",
  "my",
  "i",
  "we",
  "you",
  "your",
  "our",

  "the",
  "a",
  "an",

  "of",
  "for",
  "to",
  "from",
  "in",
  "on",
  "at",
  "with",
  "about",
  "regarding",
  "concerning",
  "related",

  "all",
  "every",
  "any",
  "some",

  "document",
  "documents",
  "doc",
  "docs",
  "file",
  "files",

  "can",
  "could",
  "would",
  "will",
])

/**
 * Normalize text for comparison.
 *
 * Unicode is retained so this can also work
 * with non-English document content.
 */
function normalizeText(
  value: string | null | undefined
): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Extract meaningful search terms.
 */
function specificWords(query: string): string[] {
  const normalized = normalizeText(query)

  const words = normalized.split(/\s+/)

  const unique = new Set<string>()

  for (const word of words) {
    if (
      word.length < 2 ||
      STOPWORDS.has(word)
    ) {
      continue
    }

    unique.add(word)
  }

  return [...unique]
}

/**
 * Build meaningful phrases from the query.
 *
 * Example:
 *
 * "give me test report of mak premix"
 *
 * gives phrases such as:
 *
 * "test report"
 * "report mak"
 * "mak premix"
 *
 * We do not hardcode any document type.
 */
function queryPhrases(query: string): string[] {
  const words = specificWords(query)

  const phrases = new Set<string>()

  if (words.length > 0) {
    phrases.add(words.join(" "))
  }

  /*
   * Two-word phrases.
   */
  for (
    let i = 0;
    i < words.length - 1;
    i++
  ) {
    phrases.add(
      `${words[i]} ${words[i + 1]}`
    )
  }

  /*
   * Three-word phrases.
   */
  for (
    let i = 0;
    i < words.length - 2;
    i++
  ) {
    phrases.add(
      `${words[i]} ${words[i + 1]} ${words[i + 2]}`
    )
  }

  return [...phrases]
}


/**
 * Extract a relationship request from natural-language document queries.
 *
 * This is intentionally UNIVERSAL: the code does not know any particular
 * laboratory, company, product, or document category. It only understands
 * relationship language such as "tested by", "issued by", "inspected by",
 * etc., and extracts the entity supplied by the user.
 */
interface RelationshipRequest {
  relation: string
  entity: string
}

const RELATION_PATTERNS: Array<{
  relation: string
  pattern: RegExp
}> = [
  { relation: "tested-by", pattern: /\btested\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "testing-by", pattern: /\btesting\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "issued-by", pattern: /\bissued\s+(?:by|from)\s+(.+)$/i },
  { relation: "conducted-by", pattern: /\bconducted\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "inspected-by", pattern: /\binspected\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "approved-by", pattern: /\bapproved\s+(?:by|from)\s+(.+)$/i },
  { relation: "certified-by", pattern: /\bcertified\s+(?:by|from)\s+(.+)$/i },
  { relation: "performed-by", pattern: /\bperformed\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "verified-by", pattern: /\bverified\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "analyzed-by", pattern: /\banaly[sz]ed\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "examined-by", pattern: /\bexamined\s+(?:by|at|from)\s+(.+)$/i },
  { relation: "tested-at", pattern: /\btest(?:ed)?\s+(?:at|in)\s+(.+)$/i },
]

function extractRelationshipRequest(query: string): RelationshipRequest | null {
  const normalized = normalizeText(query)

  for (const item of RELATION_PATTERNS) {
    const match = normalized.match(item.pattern)
    if (!match?.[1]) continue

    let entity = normalizeText(match[1])
      .replace(/^the\s+/, "")
      .replace(/\s+(?:please|thanks|thank you)$/i, "")
      .trim()

    if (entity.length < 2) continue

    return {
      relation: item.relation,
      entity,
    }
  }

  return null
}

function relationshipAnchors(relation: string): string[] {
  switch (relation) {
    case "tested-by":
    case "testing-by":
    case "tested-at":
      return [
        "tested by",
        "tested at",
        "testing laboratory",
        "testing lab",
        "test laboratory",
        "test lab",
        "laboratory",
        "lab",
      ]
    case "issued-by":
      return ["issued by", "issuing authority", "issuing laboratory", "issued from"]
    case "conducted-by":
      return ["conducted by", "conducted at", "performed by"]
    case "inspected-by":
      return ["inspected by", "inspection by", "inspection agency", "inspecting agency"]
    case "approved-by":
      return ["approved by", "approval by", "approving authority"]
    case "certified-by":
      return ["certified by", "certification by", "certification body"]
    case "performed-by":
      return ["performed by", "performed at", "carried out by"]
    case "verified-by":
      return ["verified by", "verification by", "verified at"]
    case "analyzed-by":
      return ["analyzed by", "analysed by", "analysis by", "laboratory"]
    case "examined-by":
      return ["examined by", "examination by", "laboratory"]
    default:
      return []
  }
}

/**
 * Verify that the requested entity has a meaningful relationship with the
 * requested document, instead of merely appearing somewhere in the file.
 *
 * The check is deliberately based on proximity/context and document identity.
 * It does not contain any hardcoded company or laboratory names.
 */
function hasRelationshipEvidence(
  candidate: DocumentCandidate,
  request: RelationshipRequest,
  query: string,
): boolean {
  const title = normalizeText(candidate.title)
  const fileName = normalizeText(candidate.fileName)
  const keyword = normalizeText(candidate.keyword)
  const summary = normalizeText(candidate.summary)
  const extractedText = normalizeText(candidate.extractedText)

  if (!extractedText && !title && !fileName && !summary) return false

  const entity = request.entity
  const anchors = relationshipAnchors(request.relation)
  const queryTerms = specificWords(query)
  const entityTerms = new Set(entity.split(/\s+/).filter(Boolean))
  const documentTypeTerms = queryTerms.filter(
    (term) => !entityTerms.has(term) && term.length >= 3,
  )

  const identityText = `${title} ${fileName} ${keyword} ${summary}`

  // If the entity is explicitly present in the document identity, that is
  // useful evidence, but the document still needs evidence of the requested
  // relationship or document type.
  const entityInIdentity = identityText.includes(entity)

  if (extractedText.includes(entity)) {
    const positions: number[] = []
    let from = 0

    while (true) {
      const index = extractedText.indexOf(entity, from)
      if (index < 0) break
      positions.push(index)
      from = index + Math.max(entity.length, 1)
      if (positions.length >= 20) break
    }

    for (const position of positions) {
      const windowStart = Math.max(0, position - 350)
      const windowEnd = Math.min(
        extractedText.length,
        position + entity.length + 350,
      )
      const window = extractedText.slice(windowStart, windowEnd)

      const hasAnchor = anchors.some((anchor) => window.includes(anchor))
      const hasDocumentType = documentTypeTerms.some(
        (term) => window.includes(term),
      )

      if (hasAnchor && (hasDocumentType || entityInIdentity)) {
        return true
      }
    }
  }

  // Some reports put the laboratory/entity in the title or filename and the
  // relationship wording in the extracted body. Accept that combination only
  // when the requested document-type terms are also supported.
  if (entityInIdentity) {
    const hasAnchor = anchors.some((anchor) => extractedText.includes(anchor))
    const hasDocumentType = documentTypeTerms.some(
      (term) => title.includes(term) || fileName.includes(term) || extractedText.includes(term),
    )

    if (hasAnchor && hasDocumentType) return true
  }

  return false
}

function hasRequestedDocumentTypeEvidence(
  candidate: DocumentCandidate,
  query: string,
): boolean {
  const terms = specificWords(query)
  if (terms.length === 0) return false

  const text = [
    candidate.title,
    candidate.fileName,
    candidate.keyword,
    candidate.summary,
    candidate.extractedText,
  ]
    .map(normalizeText)
    .join(" ")

  // Require at least one meaningful query term in document identity/content.
  // This is intentionally generic and does not assume a fixed category.
  return terms.some((term) => text.includes(term))
}

/**
 * Generic lexical search.
 *
 * Searches:
 *
 * - title
 * - filename
 * - keyword
 * - description
 * - summary
 * - extracted text
 */
async function keywordMatch(
  query: string,
  userId: string,
  role: Role
): Promise<DocumentCandidate[]> {
  const allowed = await visibleCategoryIds(
    userId,
    role
  )

  const words = specificWords(query)

  const phrases = queryPhrases(query)

  if (
    words.length === 0 &&
    phrases.length === 0
  ) {
    return []
  }

  const where: any = {
    deletedAt: null,
    status: "READY",
  }

  if (allowed !== null) {
    where.categoryId = {
      in: allowed.length
        ? allowed
        : ["__none__"],
    }
  }

  const documents =
    await prisma.document.findMany({
      where,
      select: {
        id: true,
        title: true,
        fileName: true,
        keyword: true,
        fileType: true,
        description: true,
        summary: true,
        extractedText: true,
      },
    })

  const results = documents
    .map((document) => {
      const title = normalizeText(
        document.title
      )

      const fileName = normalizeText(
        document.fileName
      )

      const keyword = normalizeText(
        document.keyword
      )

      const description = normalizeText(
        document.description
      )

      const summary = normalizeText(
        document.summary
      )

      const extractedText = normalizeText(
        document.extractedText
      )

      const allText = [
        title,
        fileName,
        keyword,
        description,
        summary,
        extractedText,
      ].join(" ")

      const matchedTerms: string[] = []

      for (const word of words) {
        if (allText.includes(word)) {
          matchedTerms.push(word)
        }
      }

      const phraseMatches: string[] = []

      for (const phrase of phrases) {
        if (
          phrase.length >= 4 &&
          allText.includes(phrase)
        ) {
          phraseMatches.push(phrase)
        }
      }

      let score = 0

      /*
       * Exact identity phrase matches are much stronger than a
       * generic mention in extracted text. This is especially
       * important for product names that share prefixes, e.g.
       * "MAK PREMIX" vs "MAK PREMIX INSTANT".
       */
      for (const phrase of phrases) {
        const escapedPhrase = phrase
          .replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")
          .replace(/\\s+/g, "\\\\s+")

        const identityPattern = new RegExp(
          `(?:^|\\s)${escapedPhrase}(?:$|\\s)`,
          "i"
        )

        if (
          identityPattern.test(title) ||
          identityPattern.test(fileName) ||
          identityPattern.test(keyword)
        ) {
          score += 150
        }
      }

      /*
       * Exact phrase matches.
       */
      for (const phrase of phraseMatches) {
        score += 30

        if (title.includes(phrase)) {
          score += 100
        }

        if (fileName.includes(phrase)) {
          score += 80
        }

        if (keyword.includes(phrase)) {
          score += 60
        }

        if (summary.includes(phrase)) {
          score += 25
        }

        if (extractedText.includes(phrase)) {
          score += 15
        }
      }

      /*
       * Individual term matches.
       */
      for (const word of matchedTerms) {
        score += 5

        if (title.includes(word)) {
          score += 40
        }

        if (fileName.includes(word)) {
          score += 30
        }

        if (keyword.includes(word)) {
          score += 25
        }

        if (description.includes(word)) {
          score += 10
        }

        if (summary.includes(word)) {
          score += 10
        }

        if (extractedText.includes(word)) {
          score += 5
        }
      }

      /*
       * Extra bonus when all meaningful
       * query terms are found.
       */
      if (
        words.length > 1 &&
        matchedTerms.length === words.length
      ) {
        score += 100
      }

      return {
        ...document,
        score,
        matchedTerms,
        phraseMatches,
      }
    })
    .filter(
      (document) => document.score > 0
    )
    .sort(
      (a, b) => b.score - a.score
    )

  console.log(
    `[ai:keyword] "${query}" =>`,
    results
      .slice(0, 8)
      .map(
        (result) =>
          `${result.title} (${result.score})`
      )
      .join(", ")
  )

  return results
}

/**
 * Retrieve multiple chunks per document.
 *
 * Used as a fallback when semantic retrieval
 * cannot find a chunk for a document.
 */
async function chunksForDocs(
  ids: string[],
  limitPerDoc = 5
): Promise<ChunkHit[]> {
  if (!ids.length) {
    return []
  }

  const rows =
    await prisma.$queryRawUnsafe<ChunkHit[]>(
      `
      SELECT
        c.id AS "chunkId",
        c."documentId",
        c.content,
        c.page,
        0 AS distance,
        d.title,
        d."fileName",
        d."fileType"::text AS "fileType",
        d."categoryId",
        c."chunkIndex"
      FROM "DocumentChunk" c
      INNER JOIN "Document" d
        ON d.id = c."documentId"
      WHERE
        c."documentId" = ANY($1::text[])
        AND d."deletedAt" IS NULL
        AND d.status = 'READY'
      ORDER BY
        c."documentId",
        c."chunkIndex" ASC
      `,
      ids
    )

  const counts = new Map<string, number>()

  return rows.filter((row) => {
    const count =
      counts.get(row.documentId) ?? 0

    if (count >= limitPerDoc) {
      return false
    }

    counts.set(
      row.documentId,
      count + 1
    )

    return true
  })
}

/**
 * Semantic search restricted to specific
 * documents.
 *
 * Useful when lexical search has identified
 * the correct document but we still need the
 * most relevant section inside it.
 */
async function retrieveWithinDocs(
  query: string,
  userId: string,
  role: Role,
  documentIds: string[],
  limit = 16
): Promise<ChunkHit[]> {
  if (documentIds.length === 0) {
    return []
  }

  const embedding = await embedCached(query)

  if (!embedding || embedding.length === 0) {
    return []
  }

  const vector = toVectorLiteral(embedding)

  const allowed = await visibleCategoryIds(
    userId,
    role
  )

  const permissionCondition =
    allowed === null
      ? ""
      : `AND d."categoryId" = ANY($5::text[])`

  const params: any[] = [
    vector,
    limit,
    MAX_DISTANCE,
    documentIds,
  ]

  if (allowed !== null) {
    params.push(
      allowed.length
        ? allowed
        : ["__none__"]
    )
  }

  const rows =
    await prisma.$queryRawUnsafe<ChunkHit[]>(
      `
      SELECT
        c.id AS "chunkId",
        c."documentId",
        c.content,
        c.page,
        (c.embedding <=> $1::vector) AS distance,
        d.title,
        d."fileName",
        d."fileType"::text AS "fileType",
        d."categoryId"
      FROM "DocumentChunk" c
      INNER JOIN "Document" d
        ON d.id = c."documentId"
      WHERE
        c."documentId" = ANY($4::text[])
        AND d."deletedAt" IS NULL
        AND d.status = 'READY'
        AND c.embedding IS NOT NULL
        AND (c.embedding <=> $1::vector) < $3
        ${permissionCondition}
      ORDER BY
        c.embedding <=> $1::vector
      LIMIT $2
      `,
      ...params
    )

  return rows
}

/**
 * Check whether a lexical result is strong
 * enough to be treated as an actual match.
 */
function isStrongDocumentMatch(
  candidate: DocumentCandidate
): boolean {
  const title = normalizeText(candidate.title)
  const fileName = normalizeText(candidate.fileName)
  const keyword = normalizeText(candidate.keyword)
  const summary = normalizeText(candidate.summary)

  if (
    candidate.phraseMatches.some(
      (phrase) =>
        title.includes(phrase) ||
        fileName.includes(phrase) ||
        keyword.includes(phrase)
    )
  ) {
    return true
  }

  if (
    candidate.matchedTerms.length >= 2 &&
    candidate.score >= 120
  ) {
    return true
  }

  const identityText = `${title} ${fileName} ${keyword} ${summary}`
  const identityHits = candidate.matchedTerms.filter((term) =>
    identityText.includes(term)
  ).length

  return (
    candidate.matchedTerms.length >= 2 &&
    identityHits >= 2 &&
    candidate.score >= 90
  )
}

/**
 * Merge semantic and lexical results.
 */
function rankDocumentHits(
  semanticHits: ChunkHit[],
  keywordDocs: DocumentCandidate[],
  fetchMode: boolean
): ChunkHit[] {
  const semanticByDoc =
    new Map<string, ChunkHit>()

  for (const hit of semanticHits) {
    const existing =
      semanticByDoc.get(
        hit.documentId
      )

    if (
      !existing ||
      hit.distance < existing.distance
    ) {
      semanticByDoc.set(
        hit.documentId,
        hit
      )
    }
  }

  const ranked: Array<{
    hit: ChunkHit
    score: number
  }> = []

  /*
   * Lexical matches first.
   */
  for (const document of keywordDocs) {
    const semantic =
      semanticByDoc.get(
        document.id
      )

    /*
     * For fetch requests, don't allow
     * weak unrelated documents.
     */
    if (
      fetchMode &&
      !isStrongDocumentMatch(document) &&
      !semantic
    ) {
      continue
    }

    const hit: ChunkHit =
      semantic ??
      {
        chunkId:
          `document-${document.id}`,
        documentId:
          document.id,
        content:
          document.summary ??
          document.description ??
          "",
        page: null,
        distance: 0.5,
        title:
          document.title,
        fileName:
          document.fileName,
        fileType:
          String(
            document.fileType
          ),
        categoryId:
          null,
      }

    let score = document.score

    if (semantic) {
      score += Math.max(
        0,
        40 -
          semantic.distance * 40
      )
    }

    ranked.push({
      hit,
      score,
    })
  }

  /*
   * Semantic-only matches.
   *
   * These are useful for normal questions.
   */
  if (!fetchMode) {
    for (const hit of semanticHits) {
      if (
        keywordDocs.some(
          (document) =>
            document.id ===
            hit.documentId
        )
      ) {
        continue
      }

      ranked.push({
        hit,
        score:
          40 -
          hit.distance * 40,
      })
    }
  }

  return ranked
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .map(
      (item) => item.hit
    )
}

/**
 * Remove duplicate chunks.
 */
function dedupeChunks(
  hits: ChunkHit[]
): ChunkHit[] {
  const seen =
    new Set<string>()

  return hits.filter(
    (hit) => {
      if (
        seen.has(hit.chunkId)
      ) {
        return false
      }

      seen.add(hit.chunkId)

      return true
    }
  )
}

/**
 * Remove duplicate documents.
 */
function dedupeByDoc(
  hits: ChunkHit[]
): ChunkHit[] {
  const seen =
    new Set<string>()

  return hits.filter(
    (hit) => {
      if (
        seen.has(
          hit.documentId
        )
      ) {
        return false
      }

      seen.add(
        hit.documentId
      )

      return true
    }
  )
}

/**
 * Convert document hits into the exact
 * result format expected by the frontend.
 *
 * IMPORTANT:
 * We return documentId rather than storagePath.
 *
 * The frontend/backend document APIs are
 * responsible for generating secure preview
 * and download URLs.
 */
function makeAIResults(
  hits: ChunkHit[],
  semanticHits: ChunkHit[],
  keywordDocs: DocumentCandidate[],
  limit = 10
): AIResult[] {
  const uniqueHits =
    dedupeByDoc(hits).slice(
      0,
      limit
    )

  return uniqueHits.map(
    (hit) => {
      const semantic =
        semanticHits.find(
          (item) =>
            item.documentId ===
            hit.documentId
        )

      const confidence =
        semantic
          ? Math.max(
              0,
              Math.min(
                1,
                1 -
                  semantic.distance /
                    MAX_DISTANCE
              )
            )
          : 0.75

      const lexical =
        keywordDocs.some(
          (document) =>
            document.id ===
            hit.documentId
        )

      return {
        documentId:
          hit.documentId,
        title:
          hit.title,
        fileName:
          hit.fileName,
        fileType:
          hit.fileType,
        matchedParagraph:
          hit.content?.slice(
            0,
            500
          ) ?? "",
        confidence,
        matchType:
          lexical
            ? "keyword"
            : "semantic",
      }
    }
  )
}

/**
 * Build grouped context for Gemini.
 *
 * Multiple chunks from the same document
 * are grouped together.
 */
function buildContext(
  hits: ChunkHit[],
  maxDocuments = 8,
  maxChunksPerDocument = 3
): {
  context: string
  citations: Array<{
    ref: number
    documentId: string
    title: string
    page: number | null
    snippet: string
  }>
} {
  const groups =
    new Map<
      string,
      {
        first: ChunkHit
        chunks: ChunkHit[]
      }
    >()

  for (const hit of hits) {
    if (
      !groups.has(
        hit.documentId
      )
    ) {
      if (
        groups.size >=
        maxDocuments
      ) {
        continue
      }

      groups.set(
        hit.documentId,
        {
          first: hit,
          chunks: [],
        }
      )
    }

    const group =
      groups.get(
        hit.documentId
      )!

    if (
      group.chunks.length <
      maxChunksPerDocument
    ) {
      group.chunks.push(
        hit
      )
    }
  }

  const groupArray =
    [...groups.values()]

  const context =
    groupArray
      .map(
        (group, index) => {
          const content =
            group.chunks
              .map(
                (chunk) =>
                  chunk.content
              )
              .join(
                "\n\n---\n\n"
              )

          return `[${index + 1}] Document: "${group.first.title}"${
            group.first.page
              ? ` | Page ${group.first.page}`
              : ""
          }\n\n${content}`
        }
      )
      .join(
        "\n\n====================\n\n"
      )

  const citations =
    groupArray.map(
      (group, index) => ({
        ref: index + 1,
        documentId:
          group.first.documentId,
        title:
          group.first.title,
        page:
          group.first.page,
        snippet:
          group.chunks[0]
            ?.content
            ?.slice(
              0,
              500
            ) ?? "",
      })
    )

  return {
    context,
    citations,
  }
}

/**
 * Universal query intent.
 *
 * This remains generic: no company, product, laboratory or
 * document name is hardcoded.
 */
interface QueryIntent {
  documentTypeTerms: string[]
  subjectTerms: string[]
  relationshipRequest: RelationshipRequest | null
}

const QUERY_DOCUMENT_TYPE_TERMS = new Set([
  "test", "tests", "tested", "testing",
  "report", "reports",
  "certificate", "certificates", "certification",
  "approval", "approvals",
  "inspection", "inspections",
  "warranty", "warranties",
  "manual", "manuals",
  "datasheet", "datasheets",
  "brochure", "brochures",
  "catalogue", "catalogues", "catalog", "catalogs",
  "specification", "specifications",
  "invoice", "invoices",
  "quotation", "quotations",
  "purchase", "purchases",
  "order", "orders",
  "contract", "contracts",
  "agreement", "agreements",
  "letter", "letters",
  "form", "forms",
  "statement", "statements",
  "record", "records",
  "policy", "policies",
])

function extractQueryIntent(query: string): QueryIntent {
  const normalized = normalizeText(query)
  const relationshipRequest =
    extractRelationshipRequest(normalized)

  let baseQuery = normalized

  if (relationshipRequest) {
    baseQuery = baseQuery.replace(
      /\b(tested|testing|issued|conducted|inspected|approved|certified|performed|verified|analyzed|analysed|examined)\s+(?:by|at|from|in)\s+.+$/i,
      " "
    )
  }

  const words = specificWords(baseQuery)

  const documentTypeTerms = [
    ...new Set(
      words.filter((word) =>
        QUERY_DOCUMENT_TYPE_TERMS.has(word)
      )
    ),
  ]

  const subjectTerms = [
    ...new Set(
      words.filter(
        (word) =>
          !QUERY_DOCUMENT_TYPE_TERMS.has(word)
      )
    ),
  ]

  if (relationshipRequest) {
    for (const term of specificWords(
      relationshipRequest.entity
    )) {
      if (
        !subjectTerms.includes(term) &&
        !QUERY_DOCUMENT_TYPE_TERMS.has(term)
      ) {
        subjectTerms.push(term)
      }
    }
  }

  return {
    documentTypeTerms,
    subjectTerms,
    relationshipRequest,
  }
}

function satisfiesQueryIntent(
  candidate: DocumentCandidate,
  intent: QueryIntent,
  originalQuery: string
): boolean {
  const title = normalizeText(candidate.title)
  const fileName = normalizeText(candidate.fileName)
  const keyword = normalizeText(candidate.keyword)
  const summary = normalizeText(candidate.summary)
  const extractedText = normalizeText(candidate.extractedText)

  const identityText =
    `${title} ${fileName} ${keyword} ${summary}`
  const allText =
    `${identityText} ${extractedText}`

  if (intent.subjectTerms.length > 0) {
    const subjectPhrase = intent.subjectTerms.join(" ")

    /*
     * For an explicit subject request such as:
     * "test report of MAK PREMIX"
     * "certificate of XYZ"
     *
     * prefer an exact subject match in the document identity.
     *
     * Token boundaries are important here:
     * "mak premix" must NOT match "mak premix instant".
     */
    const subjectPattern = new RegExp(
      `(?:^|\\s)${subjectPhrase
        .replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")
        .replace(/\\s+/g, "\\\\s+")}(?:$|\\s)`,
      "i"
    )

    const subjectInIdentity =
      subjectPattern.test(identityText)

    if (subjectInIdentity) {
      // Exact subject identity is the strongest signal.
    } else {
      /*
       * If the exact subject is not in the title/filename/keyword,
       * allow it in extracted content only when all subject terms
       * are present. This supports reports whose title is generic
       * but whose body identifies the tested product.
       */
      const subjectTermHits =
        intent.subjectTerms.filter((term) =>
          allText.includes(term)
        ).length

      if (
        subjectTermHits <
        intent.subjectTerms.length
      ) {
        return false
      }
    }
  }

  if (intent.documentTypeTerms.length > 0) {
    const typeHits = intent.documentTypeTerms.filter((term) =>
      allText.includes(term)
    )

    if (
      typeHits.length <
      intent.documentTypeTerms.length
    ) {
      return false
    }

    if (intent.documentTypeTerms.length >= 2) {
      const typePhrase =
        intent.documentTypeTerms.join(" ")

      if (
        !identityText.includes(typePhrase) &&
        !extractedText.includes(typePhrase)
      ) {
        let closeEnough = false

        for (const term of intent.documentTypeTerms) {
          const index = allText.indexOf(term)
          if (index < 0) continue

          const window = allText.slice(
            Math.max(0, index - 100),
            Math.min(allText.length, index + 220)
          )

          if (
            intent.documentTypeTerms.every(
              (required) => window.includes(required)
            )
          ) {
            closeEnough = true
            break
          }
        }

        if (!closeEnough) return false
      }
    }
  }

  if (intent.relationshipRequest) {
    if (
      !hasRelationshipEvidence(
        candidate,
        intent.relationshipRequest,
        originalQuery
      )
    ) {
      return false
    }
  }

  return true
}

/**
 * Main AI service.
 */
export const aiService = {
  /**
   * AI document search endpoint.
   */
  async search(
    query: string,
    userId: string,
    role: Role,
    actorName: string
  ) {
    if (!query.trim()) {
      throw ApiError.badRequest(
        "Enter a search query"
      )
    }

    const [
      semanticHits,
      keywordDocs,
    ] = await Promise.all([
      retrieve(
        query,
        userId,
        role,
        20
      ),
      keywordMatch(
        query,
        userId,
        role
      ),
    ])

    const rankedHits =
      rankDocumentHits(
        semanticHits,
        keywordDocs,
        false
      )

    const results =
      makeAIResults(
        rankedHits,
        semanticHits,
        keywordDocs,
        10
      )

    await activityService.log({
      action: "AI_SEARCH",
      actorName,
      userId,
      meta: {
        query,
        results:
          results.length,
      },
    })

    await prisma.searchHistory
      .create({
        data: {
          userId,
          query,
          mode: "ai",
          results:
            results.length,
        },
      })
      .catch(() => {})

    return {
      query,
      results,
    }
  },

  /**
   * AI chat.
   */
  async chat(
    question: string,
    userId: string,
    role: Role,
    actorName: string,
    documentId?: string
  ) {
    if (!question.trim()) {
      throw ApiError.badRequest(
        "Enter a question"
      )
    }

    const fetchMode =
      isFetchRequest(
        question
      ) && !documentId

    console.log(
      `[ai:chat] question="${question}" fetchMode=${fetchMode}`
    )

    /*
     * Run both retrieval methods.
     */
    const [
      semanticHits,
      keywordDocs,
    ] = await Promise.all([
      retrieve(
        question,
        userId,
        role,
        fetchMode ? 24 : 20
      ),
      keywordMatch(
        question,
        userId,
        role
      ),
    ])

    /*
     * DOCUMENT / FILE REQUEST
     */
    if (fetchMode) {
      const queryIntent =
        extractQueryIntent(question)

      console.log(
        "[ai:intent]",
        JSON.stringify(queryIntent)
      )

      const strongDocuments =
        keywordDocs.filter(
          (document) => {
            if (!isStrongDocumentMatch(document)) {
              return false
            }

            return satisfiesQueryIntent(
              document,
              queryIntent,
              question
            )
          }
        )

      /*
       * Do not use semantic-only results
       * for strict document retrieval.
       *
       * This prevents unrelated documents
       * from appearing as requested files.
       */
      if (
        strongDocuments.length === 0
      ) {
        await activityService.log({
          action: "AI_SEARCH",
          actorName,
          userId,
          meta: {
            question,
            mode: "fetch",
            results: 0,
          },
        })

        return {
          answer:
            "I couldn't find an exact matching document in your library. The requested document may not be uploaded or its content may not have been indexed yet.",
          citations: [],
          results: [],
        }
      }

      /*
       * Limit the number of returned documents.
       */
      const selectedDocuments =
        strongDocuments.slice(
          0,
          8
        )

      const selectedIds =
        selectedDocuments.map(
          (document) =>
            document.id
        )

      /*
       * Get relevant chunks inside ONLY
       * the selected documents.
       */
      const targetedChunks =
        await retrieveWithinDocs(
          question,
          userId,
          role,
          selectedIds,
          24
        )

      /*
       * If semantic retrieval cannot find
       * chunks inside a selected document,
       * use its first chunks as fallback.
       */
      const targetedDocumentIds =
        new Set(
          targetedChunks.map(
            (chunk) =>
              chunk.documentId
          )
        )

      const missingIds =
        selectedIds.filter(
          (id) =>
            !targetedDocumentIds.has(
              id
            )
        )

      const fallbackChunks =
        await chunksForDocs(
          missingIds,
          3
        )

      const sourceHits =
        dedupeChunks([
          ...targetedChunks,
          ...fallbackChunks,
        ])

      const grouped =
        buildContext(
          sourceHits,
          8,
          3
        )

      /*
       * IMPORTANT:
       *
       * Restore the frontend-compatible
       * results array.
       *
       * This is what allows the frontend
       * to render the actual document cards.
       */
      const documentHits =
        selectedDocuments.map(
          (document) => {
            const matchingChunk =
              sourceHits.find(
                (chunk) =>
                  chunk.documentId ===
                  document.id
              )

            return {
              chunkId:
                matchingChunk?.chunkId ??
                `document-${document.id}`,
              documentId:
                document.id,
              content:
                matchingChunk?.content ??
                document.summary ??
                document.description ??
                "",
              page:
                matchingChunk?.page ??
                null,
              distance:
                matchingChunk?.distance ??
                0.5,
              title:
                document.title,
              fileName:
                document.fileName,
              fileType:
                String(
                  document.fileType
                ),
              categoryId:
                null,
            } satisfies ChunkHit
          }
        )

      const results =
        makeAIResults(
          documentHits,
          semanticHits,
          keywordDocs,
          8
        )

      const answer =
        selectedDocuments
          .map(
            (document) => {
              const summary =
                document.summary ||
                document.description

              return summary
                ? `• ${document.title} — ${summary}`
                : `• ${document.title}`
            }
          )
          .join("\n")

      await activityService.log({
        action: "AI_SEARCH",
        actorName,
        userId,
        meta: {
          question,
          mode: "fetch",
          results:
            selectedDocuments.length,
        },
      })

      return {
        answer:
          `I found ${selectedDocuments.length} matching document${
            selectedDocuments.length ===
            1
              ? ""
              : "s"
          }:\n\n${answer}\n\nThe matching document${
            selectedDocuments.length ===
            1
              ? " is"
              : "s are"
          } available below.`,

        /*
         * Citation data is retained for
         * AI/source references.
         */
        citations:
          grouped.citations,

        /*
         * Frontend document cards use this.
         */
        results,
      }
    }

    /*
     * NORMAL QUESTION MODE
     *
     * Example:
     *
     * "What is the shelf life of MAK Premix?"
     */
    const rankedHits =
      rankDocumentHits(
        semanticHits,
        keywordDocs,
        false
      )

    let relevantHits =
      rankedHits

    /*
     * If lexical search found specific
     * documents, retrieve relevant chunks
     * inside those documents.
     */
    const lexicalIds =
      keywordDocs
        .slice(0, 8)
        .map(
          (document) =>
            document.id
        )

    if (
      lexicalIds.length > 0
    ) {
      const lexicalChunks =
        await retrieveWithinDocs(
          question,
          userId,
          role,
          lexicalIds,
          16
        )

      relevantHits =
        dedupeChunks([
          ...lexicalChunks,
          ...relevantHits,
        ])
    }

    /*
     * Remove duplicate chunks
     * after enough context is collected.
     */
    relevantHits =
      dedupeChunks(
        relevantHits
      ).slice(0, 20)

    if (
      relevantHits.length === 0
    ) {
      await activityService.log({
        action: "AI_SEARCH",
        actorName,
        userId,
        meta: {
          question,
          mode: "chat",
          results: 0,
        },
      })

      return {
        answer:
          "I couldn't find relevant information in your document library. Please try rephrasing the question or make sure the relevant document has been uploaded and processed.",
        citations: [],
        results: [],
      }
    }

    /*
     * Build grounded context.
     */
    const {
      context,
      citations,
    } = buildContext(
      relevantHits,
      8,
      4
    )

    /*
     * Restore document results for the
     * frontend even for normal questions.
     */
    const results =
      makeAIResults(
        relevantHits,
        semanticHits,
        keywordDocs,
        10
      )

    /*
     * Grounded Gemini prompt.
     */
    const systemPrompt = `
You are the AI document assistant for the MAKPHALT company.

Your job is to answer questions using ONLY the document context supplied to you.

IMPORTANT RULES:

1. Use only the supplied document context.
2. Do not use outside knowledge.
3. Do not guess or invent facts.
4. If the answer is not present in the context, clearly say that the information was not found in the available documents.
5. Give a concise and useful answer.
6. When making a factual statement, cite the supporting source using [1], [2], etc.
7. Do not cite a document unless the supplied context actually supports the statement.
8. Do not combine unrelated documents simply because they mention the same company, product, person, or keyword.
9. Prefer the document/chunk that directly answers the question.
10. If documents disagree, clearly mention the disagreement rather than choosing a value yourself.
11. Never invent document names, page numbers, links, specifications, dates, test results, prices, certifications, or other facts.
12. The application will provide clickable document links separately.
`

    let answer: string

    try {
      answer =
        await getAIProvider().chat(
          systemPrompt,
          `
DOCUMENT CONTEXT:

${context}

USER QUESTION:

${question}
`
        )
    } catch (error: any) {
      console.error(
        "[ai:chat] provider error:",
        error?.response?.data ??
          error?.message ??
          error
      )

      /*
       * If Gemini is rate limited,
       * still return useful document
       * information and document results.
       */
      if (
        error?.response?.status ===
        429
      ) {
        const names =
          dedupeByDoc(
            relevantHits
          )
            .slice(0, 6)
            .map(
              (hit) =>
                `• ${hit.title}`
            )
            .join("\n")

        return {
          answer:
            `I found relevant information in these documents:\n\n${names}\n\nAI summarization is temporarily unavailable because the AI provider is rate-limited. The documents are available below.`,

          citations,

          results,
        }
      }

      throw error
    }

    await activityService.log({
      action: "AI_SEARCH",
      actorName,
      userId,
      meta: {
        question,
        mode: "chat",
        results:
          citations.length,
      },
    })

    /*
     * FINAL RESPONSE
     *
     * answer:
     *   AI-generated grounded answer
     *
     * citations:
     *   source references
     *
     * results:
     *   frontend-compatible document cards
     */
    return {
      answer:
        answer.trim(),
      citations,
      results,
    }
  },
}