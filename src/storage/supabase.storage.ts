import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { env } from "../config/env.js"
import { ApiError } from "../utils/ApiError.js"

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!env.supabase.enabled) {
    throw ApiError.internal(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    )
  }

  if (!client) {
    client = createClient(
      env.supabase.url,
      env.supabase.serviceRoleKey,
      {
        auth: {
          persistSession: false,
        },
      }
    )
  }

  return client
}

export const storage = {
  enabled: env.supabase.enabled,

  /** Upload a buffer to the configured bucket. Returns the object path. */
  async upload(
    path: string,
    buffer: Buffer,
    contentType: string
  ): Promise<string> {
    const supabase = getClient()

    const { error } = await supabase.storage
      .from(env.supabase.bucket)
      .upload(path, buffer, {
        contentType,
        upsert: false,
      })

    if (error) {
      throw ApiError.internal(
        `Storage upload failed: ${error.message}`
      )
    }

    return path
  },

  /**
   * Create a time-limited signed URL.
   *
   * download = undefined
   * → Browser can preview PDF/images.
   *
   * download = filename
   * → Browser is instructed to download the file.
   */
  async signedUrl(
    path: string,
    expiresInSeconds = 60 * 60,
    download?: string | boolean
  ): Promise<string> {
    const supabase = getClient()

    const { data, error } = await supabase.storage
      .from(env.supabase.bucket)
      .createSignedUrl(
        path,
        expiresInSeconds,
        download !== undefined
          ? { download }
          : undefined
      )

    if (error || !data) {
      throw ApiError.internal(
        `Could not create signed URL: ${
          error?.message ?? "Unknown error"
        }`
      )
    }

    return data.signedUrl
  },

  /** Download an object as a Buffer (used by the AI processing pipeline). */
  async download(path: string): Promise<Buffer> {
    const supabase = getClient()

    const { data, error } = await supabase.storage
      .from(env.supabase.bucket)
      .download(path)

    if (error || !data) {
      throw ApiError.internal(
        `Storage download failed: ${
          error?.message ?? "Unknown error"
        }`
      )
    }

    return Buffer.from(await data.arrayBuffer())
  },

  /** Remove objects from Supabase Storage. */
  async remove(paths: string[]): Promise<void> {
    const supabase = getClient()

    const { error } = await supabase.storage
      .from(env.supabase.bucket)
      .remove(paths)

    if (error) {
      throw ApiError.internal(
        `Storage delete failed: ${error.message}`
      )
    }
  },
}