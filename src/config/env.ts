import "dotenv/config"

function required(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback

  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`)
  }

  return val
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  isProd:
    process.env.NODE_ENV === "production",

  port:
    Number(process.env.PORT ?? 4000),

  corsOrigin:
    (process.env.CORS_ORIGIN ??
      "http://localhost:5173").split(","),

  jwtSecret:
    required(
      "JWT_SECRET",
      "dev-insecure-secret-change-me"
    ),

  jwtExpiresIn:
    process.env.JWT_EXPIRES_IN ?? "7d",

  storageLimitGb:
    Number(
      process.env.STORAGE_LIMIT_GB ?? 1
    ),

  maxFileSizeMb:
    Number(
      process.env.MAX_FILE_SIZE_MB ?? 25
    ),

  supabase: {
    url:
      process.env.SUPABASE_URL ?? "",

    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

    bucket:
      (
        process.env.SUPABASE_BUCKET ??
        "Documents"
      ).trim(),

    enabled:
      Boolean(
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
  },

  ai: {
    provider:
      (process.env.AI_PROVIDER ??
        "ollama") as
        | "ollama"
        | "gemini"
        | "openai",

    ollamaBaseUrl:
      process.env.OLLAMA_BASE_URL ??
      "http://localhost:11434",

    ollamaChatModel:
      process.env.OLLAMA_CHAT_MODEL ??
      "llama3.1",

    ollamaEmbedModel:
      process.env.OLLAMA_EMBED_MODEL ??
      "nomic-embed-text",

    geminiApiKey:
      process.env.GEMINI_API_KEY ?? "",

    geminiChatModel:
      process.env.GEMINI_CHAT_MODEL ??
      "gemini-3.5-flash",

    openaiApiKey:
      process.env.OPENAI_API_KEY ?? "",
  },
}