import axios from "axios"
import { env } from "../config/env.js"

/**
 * Retry a request when the provider returns 429 (rate limit).
 * Waits progressively longer between attempts (1s, 2s, 4s) — respects the
 * free-tier quota so a burst of requests doesn't fail outright.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      const status = err?.response?.status
      if (status !== 429 && status !== 503) throw err // only retry rate/overload errors
      const waitMs = 1000 * Math.pow(2, i) // 1s, 2s, 4s
      console.warn(`[ai] ${status} rate-limited — retrying in ${waitMs}ms (attempt ${i + 1}/${attempts})`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

/**
 * Pluggable AI provider. Default is Ollama (local, free). Gemini and OpenAI
 * are supported when their API keys are set and AI_PROVIDER is switched.
 * Everything the app needs reduces to two primitives: embed() and chat().
 */

export interface AIProvider {
  embed(texts: string[]): Promise<number[][]>
  chat(system: string, user: string): Promise<string>
  /** Optional: extract text from an image buffer (OCR). Providers without vision return "". */
  vision?(imageBase64: string, mimeType: string): Promise<string>
}

// ── Ollama (default) ────────────────────────────────────────────────
const ollama: AIProvider = {
  async embed(texts) {
    const out: number[][] = []
    for (const text of texts) {
      const { data } = await axios.post(`${env.ai.ollamaBaseUrl}/api/embeddings`, {
        model: env.ai.ollamaEmbedModel,
        prompt: text,
      })
      out.push(data.embedding as number[])
    }
    return out
  },
  async chat(system, user) {
    const { data } = await axios.post(`${env.ai.ollamaBaseUrl}/api/chat`, {
      model: env.ai.ollamaChatModel,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })
    return data.message?.content ?? ""
  },
}

// ── Google Gemini ───────────────────────────────────────────────────
const gemini: AIProvider = {
  async embed(texts) {
    const out: number[][] = []
    for (const text of texts) {
      const { data } = await withRetry(() => axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${env.ai.geminiApiKey}`,
        { content: { parts: [{ text }] }, outputDimensionality: 768 }
      ))
      out.push(data.embedding.values as number[])
    }
    return out
  },
  async chat(system, user) {
    const { data } = await withRetry(() => axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.ai.geminiApiKey}`,
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: user }] }] }
    ))
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  },
  async vision(imageBase64, mimeType) {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.ai.geminiApiKey}`,
      {
        contents: [{
          parts: [
            { text: "Extract ALL text visible in this image exactly as written, including any Hindi/Devanagari text, numbers, labels, and headings. Output only the extracted text, no commentary. If there is no readable text, output an empty response." },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        }],
      }
    )
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  },
}

// ── OpenAI ──────────────────────────────────────────────────────────
const openai: AIProvider = {
  async embed(texts) {
    const { data } = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { model: "text-embedding-3-small", input: texts },
      { headers: { Authorization: `Bearer ${env.ai.openaiApiKey}` } }
    )
    return data.data.map((d: { embedding: number[] }) => d.embedding)
  },
  async chat(system, user) {
    const { data } = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      { headers: { Authorization: `Bearer ${env.ai.openaiApiKey}` } }
    )
    return data.choices?.[0]?.message?.content ?? ""
  },
}

const providers: Record<string, AIProvider> = { ollama, gemini, openai }

export function getAIProvider(): AIProvider {
  return providers[env.ai.provider] ?? ollama
}