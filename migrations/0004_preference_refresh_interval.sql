ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS refresh_interval TEXT NOT NULL DEFAULT 'daily';
