CREATE TABLE IF NOT EXISTS repositories (
  id SERIAL PRIMARY KEY,
  github_id BIGINT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  description TEXT,
  primary_language TEXT,
  license_spdx TEXT,
  topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_fork BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  size_kb INTEGER NOT NULL DEFAULT 0,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS repository_snapshots (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  stars INTEGER NOT NULL,
  forks INTEGER NOT NULL,
  open_issues INTEGER NOT NULL,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS repo_scores (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  trend_score INTEGER NOT NULL,
  learning_value_score INTEGER NOT NULL,
  cloneability_score INTEGER NOT NULL,
  repo_health_score INTEGER NOT NULL,
  user_match_score INTEGER NOT NULL,
  final_score INTEGER NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repo_analyses (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  analysis JSONB NOT NULL,
  confidence REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS radar_runs (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  run_date TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  raw_candidate_count INTEGER NOT NULL DEFAULT 0,
  recommendation_count INTEGER NOT NULL DEFAULT 0,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radar_runs_finished_at_idx ON radar_runs (finished_at DESC);

CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  recommendation_date TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repo_interactions (
  user_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  want_to_learn BOOLEAN NOT NULL DEFAULT FALSE,
  bookmarked BOOLEAN NOT NULL DEFAULT FALSE,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  too_hard BOOLEAN NOT NULL DEFAULT FALSE,
  too_easy BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, repo_id)
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  value BOOLEAN NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_events_user_created_idx ON feedback_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_runs (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
