CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  interests JSONB NOT NULL DEFAULT '[]'::jsonb,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  level TEXT NOT NULL DEFAULT 'intermediate',
  goal TEXT NOT NULL DEFAULT 'clone',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
