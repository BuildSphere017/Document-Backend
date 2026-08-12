# MAKPHALT DMS — Backend API

Enterprise document-management backend. Node + Express + Prisma + PostgreSQL
(with pgvector) + Supabase Storage, JWT auth and role-based access control.

This is the **auth + core foundation**: authentication, users (admin panel API),
categories, dashboard aggregation, and activity logging — everything the frontend
currently calls. The document/upload pipeline, AI search, screenshot search and
chat-with-documents build on top of this in the next steps.

## Tech stack
- **Express 4** (controllers / routes / services / middleware layering)
- **Prisma 5** ORM → **PostgreSQL** + **pgvector** (768-dim embeddings)
- **Supabase Storage** for files (only metadata lives in Postgres)
- **JWT** auth (bcrypt password hashing) + **RBAC** (ADMIN / MANAGER / SALES)
- **Zod** validation, **helmet**, **cors**, **compression**, **rate-limiting**
- Pluggable AI: **Ollama** (default, local/free) · Gemini · OpenAI

## Prerequisites
- Node 18+
- A PostgreSQL database with the `vector` extension available
  (local Postgres with pgvector, or a Supabase project)
- (Optional now, required for uploads) a Supabase project + Storage bucket
- (Optional) [Ollama](https://ollama.com) running locally with:
  ```bash
  ollama pull llama3.1
  ollama pull nomic-embed-text
  ```

## Setup
```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL, JWT_SECRET, Supabase keys

# 1) Generate the Prisma client
npm run prisma:generate

# 2) Create the schema
npm run prisma:migrate --name init

# 3) Enable pgvector + the HNSW index (run once)
psql "$DATABASE_URL" -f prisma/sql/01_pgvector.sql

# 4) Seed the admin, default categories, and a sample sales user
npm run db:seed

# 5) Start
npm run dev                   # http://localhost:4000/api
```

After seeding, log in with the credentials printed by the seed script
(defaults: username `rishabh`, password `ChangeMe123!` — change these in `.env`).

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run db:seed` | Seed admin + categories + sample user |
| `npm run prisma:studio` | Open Prisma Studio |

## Project structure
```
src/
  config/       env, prisma client
  controllers/  thin HTTP handlers
  routes/       express routers (auth, users, categories, dashboard, activity)
  services/     business logic (auth, user, category, dashboard, activity)
  middleware/   auth (JWT), authorize (RBAC), validate (Zod), error, rateLimit, upload
  validation/   Zod schemas
  storage/      Supabase Storage adapter
  ai/           pluggable AI provider (Ollama/Gemini/OpenAI)
  utils/        ApiError, asyncHandler, serialize (BigInt→number), fileType
prisma/
  schema.prisma
  seed.ts
  sql/01_pgvector.sql
```

## Security
- Passwords hashed with bcrypt (cost 12)
- JWT bearer auth; `authenticate` re-checks the user is active on every request
- `authorize(...roles)` enforces RBAC per route
- Global + strict auth rate limiters
- Zod validation on every mutating endpoint
- helmet security headers, CORS locked to `CORS_ORIGIN`
- Soft-deletes (`deletedAt`) preserve audit history

## API reference
See `API.md` for the full endpoint list, request bodies, and role requirements.
