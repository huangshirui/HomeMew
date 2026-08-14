CREATE TABLE IF NOT EXISTS wechat_identity_mappings (
  openid TEXT PRIMARY KEY,
  lifespace_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(openid) > 0),
  CHECK (lifespace_user_id LIKE 'usr_%')
);

CREATE INDEX IF NOT EXISTS idx_wechat_identity_lifespace_user
  ON wechat_identity_mappings(lifespace_user_id);
