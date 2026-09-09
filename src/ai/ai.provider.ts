import axios from "axios"
import { env } from "../config/env.js"

/**
 * Retry only temporary provider errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastErr: any

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err

      const status = err?.response?.status

      if (status !== 429 && status !== 500 && status !== 503) {
        throw err
      }

      const waitMs = 1000 * Math.pow(2, i)

      console.warn(
        `[ai] ${status} — retrying in ${waitMs}ms (attempt ${
          i + 1
        }/${attempts})`
      )

      await new Promise((resolve) =>
        setTimeout(resolve, waitMs)
      )
    }
  }

  throw lastErr
}

export interface AIProvider {
  embed(texts: string[]): Promise<number[][]>

  chat(
    system: string,
    user: string
  ): Promise<string>

  vision?(
    imageBase64: string,
    mimeType: string
  ): Promise<string>
}

/**
 * Gemini API headers.
 *
 * IMPORTANT:
 * The API key is intentionally NOT placed in the URL.
 */
function geminiHeaders() {
  if (!env.ai.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured"
    )
  }

  return {
    "x-goog-api-key": env.ai.geminiApiKey,
    "Content-Type": "application/json",
  }
}

/**
 * Google Gemini
 *
 * Chat/vision model is configurable through:
 *
 * GEMINI_CHAT_MODEL
 *
 * Recommended:
 * GEMINI_CHAT_MODEL=gemini-3.5-flash
 */
const gemini: AIProvider = {
  /**
   * Generate embeddings.
   *
   * Uses gemini-embedding-001 with
   * outputDimensionality = 768.
   *
   * This MUST stay 768 because the
   * DocumentChunk vector column is
   * configured for 768 dimensions.
   */
  async embed(texts) {
    if (!env.ai.geminiApiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured"
      )
    }

    const out: number[][] = []

    for (const text of texts) {
      const { data } = await withRetry(() =>
        axios.post(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
          {
            content: {
              parts: [
                {
                  text,
                },
              ],
            },

            outputDimensionality: 768,
          },
          {
            headers: geminiHeaders(),
          }
        )
      )

      const values =
        data?.embedding?.values

      if (!Array.isArray(values)) {
        throw new Error(
          "Gemini embedding response did not contain embedding values"
        )
      }

      out.push(values)
    }

    return out
  },

  /**
   * Gemini text chat.
   */
  async chat(system, user) {
    if (!env.ai.geminiApiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured"
      )
    }

    const model =
      env.ai.geminiChatModel

    if (!model) {
      throw new Error(
        "GEMINI_CHAT_MODEL is not configured"
      )
    }

    const { data } = await withRetry(() =>
      axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          systemInstruction: {
            parts: [
              {
                text: system,
              },
            ],
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: user,
                },
              ],
            },
          ],
        },
        {
          headers: geminiHeaders(),
        }
      )
    )

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(
          (part: any) =>
            part?.text ?? ""
        )
        .join("")
        .trim() ?? ""

    if (!text) {
      const finishReason =
        data?.candidates?.[0]?.finishReason

      throw new Error(
        `Gemini returned an empty response${
          finishReason
            ? ` (${finishReason})`
            : ""
        }`
      )
    }

    return text
  },

  /**
   * Gemini Vision.
   *
   * Used for:
   * - images
   * - scanned PDF pages
   * - documents where normal text extraction fails
   */
  async vision(
    imageBase64,
    mimeType
  ) {
    if (!env.ai.geminiApiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured"
      )
    }

    const model =
      env.ai.geminiChatModel

    if (!model) {
      throw new Error(
        "GEMINI_CHAT_MODEL is not configured"
      )
    }

    const { data } = await withRetry(() =>
      axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          contents: [
            {
              role: "user",

              parts: [
                {
                  text:
                    "Extract ALL readable text from this image exactly as written. " +
                    "Preserve numbers, labels, headings, tables and Hindi/Devanagari text. " +
                    "Preserve the original wording as accurately as possible. " +
                    "Output only the extracted text. " +
                    "Do not add explanations or commentary. " +
                    "If there is no readable text, return an empty response.",
                },

                {
                  inline_data: {
                    mime_type:
                      mimeType,
                    data:
                      imageBase64,
                  },
                },
              ],
            },
          ],
        },
        {
          headers: geminiHeaders(),
        }
      )
    )

    return (
      data?.candidates?.[0]?.content?.parts
        ?.map(
          (part: any) =>
            part?.text ?? ""
        )
        .join("")
        .trim() ?? ""
    )
  },
}

/**
 * Ollama
 *
 * Kept for local development only.
 */
const ollama: AIProvider = {
  async embed(texts) {
    const out: number[][] = []

    for (const text of texts) {
      const { data } =
        await axios.post(
          `${env.ai.ollamaBaseUrl}/api/embeddings`,
          {
            model:
              env.ai.ollamaEmbedModel,
            prompt: text,
          }
        )

      out.push(
        data.embedding as number[]
      )
    }

    return out
  },

  async chat(system, user) {
    const { data } =
      await axios.post(
        `${env.ai.ollamaBaseUrl}/api/chat`,
        {
          model:
            env.ai.ollamaChatModel,

          stream: false,

          messages: [
            {
              role: "system",
              content: system,
            },
            {
              role: "user",
              content: user,
            },
          ],
        }
      )

    return (
      data.message?.content ?? ""
    )
  },
}

/**
 * OpenAI
 *
 * Kept as an optional provider.
 */
const openai: AIProvider = {
  async embed(texts) {
    if (!env.ai.openaiApiKey) {
      throw new Error(
        "OPENAI_API_KEY is not configured"
      )
    }

    const { data } =
      await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          model:
            "text-embedding-3-small",

          input: texts,
        },
        {
          headers: {
            Authorization:
              `Bearer ${env.ai.openaiApiKey}`,
          },
        }
      )

    return data.data.map(
      (
        item: {
          embedding: number[]
        }
      ) => item.embedding
    )
  },

  async chat(system, user) {
    if (!env.ai.openaiApiKey) {
      throw new Error(
        "OPENAI_API_KEY is not configured"
      )
    }

    const { data } =
      await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",

          messages: [
            {
              role: "system",
              content: system,
            },
            {
              role: "user",
              content: user,
            },
          ],
        },
        {
          headers: {
            Authorization:
              `Bearer ${env.ai.openaiApiKey}`,
          },
        }
      )

    return (
      data?.choices?.[0]
        ?.message?.content ?? ""
    )
  },
}

/**
 * Available providers.
 */
const providers: Record<
  string,
  AIProvider
> = {
  ollama,
  gemini,
  openai,
}

/**
 * Get the configured AI provider.
 */
export function getAIProvider(): AIProvider {
  const provider =
    providers[env.ai.provider]

  if (!provider) {
    throw new Error(
      `Unsupported AI provider: ${env.ai.provider}`
    )
  }

  return provider
}