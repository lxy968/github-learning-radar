CREATE TABLE IF NOT EXISTS learning_progress (
  user_id TEXT NOT NULL REFERENCES anonymous_sessions(user_id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  client_updated_at TIMESTAMPTZ NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, plan_id, step_id)
);

CREATE INDEX IF NOT EXISTS learning_progress_user_updated_idx
  ON learning_progress (user_id, server_updated_at DESC);
