CREATE TABLE IF NOT EXISTS anonymous_sessions (
  user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

INSERT INTO anonymous_sessions (user_id, expires_at)
SELECT user_id, NOW() + INTERVAL '10 years' FROM user_preferences
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO anonymous_sessions (user_id, expires_at)
SELECT DISTINCT user_id, NOW() + INTERVAL '10 years' FROM repo_interactions
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO anonymous_sessions (user_id, expires_at)
SELECT DISTINCT user_id, NOW() + INTERVAL '10 years' FROM feedback_events
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_session_fk
  FOREIGN KEY (user_id) REFERENCES anonymous_sessions(user_id) ON DELETE CASCADE;

ALTER TABLE repo_interactions
  ADD CONSTRAINT repo_interactions_session_fk
  FOREIGN KEY (user_id) REFERENCES anonymous_sessions(user_id) ON DELETE CASCADE;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_session_fk
  FOREIGN KEY (user_id) REFERENCES anonymous_sessions(user_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS anonymous_sessions_expires_idx
  ON anonymous_sessions (expires_at);
