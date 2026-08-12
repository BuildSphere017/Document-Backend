-- Run once against your database (or include in a Prisma migration).
-- Enables the vector extension and adds an approximate-nearest-neighbour index.
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW index for fast cosine similarity search over document chunk embeddings.
-- Prisma can't manage vector indexes, so this is applied manually.
CREATE INDEX IF NOT EXISTS document_chunk_embedding_hnsw
  ON "DocumentChunk"
  USING hnsw (embedding vector_cosine_ops);
