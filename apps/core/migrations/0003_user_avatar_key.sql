-- User avatars are owned by HomeMew and stored in the AVATARS R2 bucket.
-- There is no production data yet, so remove the legacy arbitrary URL column
-- instead of carrying a compatibility path.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_from TEXT NOT NULL CHECK (created_from IN ('wechat_miniprogram', 'wecom', 'admin', 'other')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (
  id,
  display_name,
  avatar_key,
  status,
  created_from,
  created_at,
  updated_at
)
SELECT
  id,
  display_name,
  NULL,
  status,
  created_from,
  created_at,
  updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys = ON;
