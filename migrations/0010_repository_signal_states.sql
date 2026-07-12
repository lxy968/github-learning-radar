ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS enrichment_signals JSONB NOT NULL DEFAULT '{}'::jsonb;
