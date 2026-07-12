ALTER TABLE detailed_study_plans
  ADD COLUMN IF NOT EXISTS cache_key TEXT,
  ADD COLUMN IF NOT EXISTS input_hash TEXT,
  ADD COLUMN IF NOT EXISTS preference_level TEXT,
  ADD COLUMN IF NOT EXISTS preference_goal TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS cache_provider TEXT,
  ADD COLUMN IF NOT EXISTS cache_model TEXT;

UPDATE detailed_study_plans
SET
  cache_key = COALESCE(cache_key, 'legacy:' || plan_id),
  input_hash = COALESCE(input_hash, 'legacy'),
  preference_level = COALESCE(preference_level, 'intermediate'),
  preference_goal = COALESCE(preference_goal, 'clone'),
  prompt_version = COALESCE(prompt_version, 'legacy'),
  schema_version = COALESCE(schema_version, 'legacy'),
  cache_provider = COALESCE(cache_provider, 'rule'),
  cache_model = COALESCE(cache_model, 'legacy');

ALTER TABLE detailed_study_plans
  ALTER COLUMN cache_key SET NOT NULL,
  ALTER COLUMN input_hash SET NOT NULL,
  ALTER COLUMN preference_level SET NOT NULL,
  ALTER COLUMN preference_goal SET NOT NULL,
  ALTER COLUMN prompt_version SET NOT NULL,
  ALTER COLUMN schema_version SET NOT NULL,
  ALTER COLUMN cache_provider SET NOT NULL,
  ALTER COLUMN cache_model SET NOT NULL;

ALTER TABLE detailed_study_plans
  DROP CONSTRAINT IF EXISTS detailed_study_plans_repo_id_duration_key;

DROP INDEX IF EXISTS detailed_study_plans_repo_duration_idx;

CREATE UNIQUE INDEX IF NOT EXISTS detailed_study_plans_cache_key_idx
  ON detailed_study_plans (cache_key);

CREATE INDEX IF NOT EXISTS detailed_study_plans_repo_duration_generated_idx
  ON detailed_study_plans (repo_id, duration, generated_at DESC);
