ALTER TABLE radar_runs
  ADD COLUMN IF NOT EXISTS preference_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE repo_analyses
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS fallback_reason TEXT,
  ADD COLUMN IF NOT EXISTS provider_attempts JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE repo_analyses
SET run_id = COALESCE(run_id, 'legacy-analysis:' || id::text);

ALTER TABLE repo_analyses
  ALTER COLUMN run_id SET NOT NULL;

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS analysis_source TEXT NOT NULL DEFAULT 'legacy';

UPDATE recommendations
SET run_id = COALESCE(run_id, 'legacy-recommendation:' || id::text);

ALTER TABLE recommendations
  ALTER COLUMN run_id SET NOT NULL;

DELETE FROM repo_scores older
USING repo_scores newer
WHERE older.run_id = newer.run_id
  AND older.repo_id = newer.repo_id
  AND older.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS repo_scores_run_repo_idx
  ON repo_scores (run_id, repo_id);

CREATE UNIQUE INDEX IF NOT EXISTS repo_analyses_run_repo_idx
  ON repo_analyses (run_id, repo_id);

CREATE UNIQUE INDEX IF NOT EXISTS recommendations_run_repo_idx
  ON recommendations (run_id, repo_id);

CREATE UNIQUE INDEX IF NOT EXISTS recommendations_run_rank_idx
  ON recommendations (run_id, rank);
