# Where to put your Supabase values

Short version: **you only ever edit ONE file — `.env`.** No secret is typed
anywhere else, and I never need to see them. This guide shows exactly which
Supabase value goes on which line.

> ⚠️ You pasted your old service_role key and DB password in chat earlier.
> Those are compromised. In Supabase, **reset both** before using them:
> Settings → API → reset `service_role`, and Settings → Database → reset password.
> Use a **letters+numbers-only** password (no `@ # $ %`).

---

## The only file you touch: `.env`

```bash
cd makphalt-dms-api
cp .env.example .env      # then open .env and fill the 5 blanks
```

`.env` is **gitignored** — it never leaves your computer, never goes to GitHub,
and you never send it to me.

---

## The 5 blanks — what goes where

Everything public (your project URL and ref) is already filled in. You add 5 things:

| Blank | Line in `.env` | Supabase value | Where to find it |
|---|---|---|---|
| **1** | `DATABASE_URL` **and** `DIRECT_URL` (replace `YOUR-PASSWORD` in both) | your **DB password** | you set it when you reset the password |
| **2** | `JWT_SECRET` | any long random string | run `openssl rand -hex 32` and paste the output |
| **3** | `SEED_ADMIN_PASSWORD` | a password *you* choose | this becomes your admin login password |
| **4** | `SUPABASE_SERVICE_ROLE_KEY` | your **new service_role key** | Dashboard → Settings → API → Project API keys → `service_role` |
| **5** | `GEMINI_API_KEY` / `OPENAI_API_KEY` (optional) | only if you switch AI provider | leave blank to use local Ollama |

That's it. Save the file. You're done editing.

---

## The connection string, explained (blank 1)

Supabase → **Settings → Database → Connection string → "URI" tab** gives you a URL like:

```
postgresql://postgres.soaovbuoudpqhrqdygiz:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Two rules that trip everyone up:

1. **Two ports, two purposes** — the `.env` already has both set up for you:
   - `DATABASE_URL` → port **6543** (pooled) — the running app uses this.
   - `DIRECT_URL` → port **5432** (direct) — `prisma migrate` uses this.
   You only need to drop your **password** into the `YOUR-PASSWORD` slot in each.

2. **Region host** — the `.env` assumes **Mumbai (`ap-south-1`)**. If your project
   is in another region, copy the host from your own URI (the
   `aws-0-<region>.pooler.supabase.com` part) into both lines.

If your password somehow still contains a symbol, percent-encode it
(`@` → `%40`, `#` → `%23`). Easiest fix: use a letters+numbers-only password.

---

## Two clicks in the dashboard (not in any file)

These are done in the Supabase UI, not in code:

1. **Enable pgvector** — Database → Extensions → search `vector` → toggle **on**.
2. **Create the bucket** — Storage → New bucket → name it **`Documents`** → **Private**.

---

## One SQL paste (no local psql needed)

Supabase → **SQL Editor → New query** → paste the contents of
`prisma/sql/01_pgvector.sql` (in this project) → **Run**. This adds the vector
index used by AI search. You run this once, after the migration below.

---

## Run it (in the `makphalt-dms-api` folder)

```bash
npm install
npm run prisma:generate
npm run prisma:migrate --name init    # creates all tables in Supabase (uses DIRECT_URL)
# → now paste prisma/sql/01_pgvector.sql into the Supabase SQL Editor and Run it
npm run db:seed                        # creates your admin + default categories
npm run dev                            # → http://localhost:4000/api
```

Success looks like:
```
✓ Database connected
🚀 MAKPHALT DMS API running → http://localhost:4000/api
```

The seed step prints your admin login (username `rishabh`, and whatever you set
for `SEED_ADMIN_PASSWORD`). Use those on the frontend login page.

---

## Which code files read these values? (FYI — you don't edit them)

For transparency, here's where the values are *consumed* (all already written):

- `src/config/env.ts` — reads every `.env` value into a typed config object.
- `prisma/schema.prisma` — reads `DATABASE_URL` + `DIRECT_URL`.
- `src/storage/supabase.storage.ts` — reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the `SUPABASE_BUCKET` value (`Documents` in your Supabase project).
- `prisma/seed.ts` — reads the `SEED_ADMIN_*` values.

You never open these to add secrets — they all pull from `.env`.

---

## Quick troubleshooting

| Symptom | Fix |
|---|---|
| `password authentication failed` | Password wrong, or a symbol isn't encoded. Reset to letters+numbers only, update **both** URL lines. |
| `Can't reach database server` | Wrong region host, or project is paused (free tier pauses after ~1 week — click "Restore"). |
| `migrate` hangs or errors on pooler | It's meant to use `DIRECT_URL` (port 5432) — make sure that line is filled. |
| `type "vector" does not exist` | You haven't enabled the pgvector extension (Database → Extensions). |
| Uploads fail later | `Documents` bucket missing, or service_role key not pasted. |

---

## Enabling AI search & chat (Gemini)

The app uses Google Gemini for embeddings + grounded chat. It's free to start.

1. Get a key → https://aistudio.google.com/apikey (sign in with Google → Create API key).
2. In `.env` set:
   ```
   AI_PROVIDER=gemini
   GEMINI_API_KEY="your-key-here"
   ```
3. Restart the backend.

**How it works once enabled:**
- When an ADMIN uploads a document, the backend automatically extracts its text
  (PDF/DOCX/XLSX, and OCR for images), splits it into chunks, generates embeddings
  with Gemini, and stores them as vectors in the `DocumentChunk` table (pgvector).
  The document's status goes `PROCESSING → READY` when done.
- On the **Documents** page, flip the **"Search with AI"** toggle to search by meaning.
- The **AI Search** page offers semantic search + a chat tab. The floating assistant
  (bottom-right) also answers from your documents.
- Every answer is grounded: it only uses your uploaded documents and cites sources.
  Access rules still apply — sales users only search their permitted categories.

**No key yet?** The app still runs — uploads work and manual search works. AI search/chat
just won't return results until a key is set. Documents uploaded before you add the key
can be re-processed by re-uploading them.

**OCR note:** image OCR uses Tesseract.js, which downloads a language model on first use
and can be slow for large images. PDF/DOCX/XLSX text extraction is fast.
