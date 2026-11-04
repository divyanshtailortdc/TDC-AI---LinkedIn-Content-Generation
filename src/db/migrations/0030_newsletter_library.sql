-- The newsletter library (src/lib/intel): each story gets an embedding, so
-- runs match stories to their goals by meaning, and stories and articles get
-- full-text search for the Library page. Two article fields nothing read are
-- dropped (description, fetched_at). Stories already stored are embedded by
-- the next extraction passes.
ALTER TABLE "intel_articles" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(summary, '')), 'B') || setweight(to_tsvector('simple', left(coalesce(content, ''), 100000)), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD COLUMN "embedding_model" varchar(100);--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(headline, '')), 'A') || setweight(to_tsvector('simple', coalesce(blurb, '')), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "intel_articles_search_idx" ON "intel_articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "intel_mentions_embedding_idx" ON "intel_mentions" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "intel_mentions_search_idx" ON "intel_mentions" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "intel_articles" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "intel_articles" DROP COLUMN "fetched_at";