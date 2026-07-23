ALTER TABLE families ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE events ADD COLUMN mutation_token TEXT;
ALTER TABLE tasks ADD COLUMN mutation_token TEXT;
CREATE TABLE family_invite_redemptions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES family_invites(id),
  family_id TEXT NOT NULL REFERENCES families(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER consume_family_invite_after_redemption AFTER INSERT ON family_invite_redemptions
BEGIN
  UPDATE family_invites SET used_count=used_count+1,
    status=CASE WHEN used_count+1>=max_uses THEN 'exhausted' ELSE status END,
    updated_at=CURRENT_TIMESTAMP WHERE id=NEW.invite_id;
END;
CREATE INDEX idx_invite_redemptions_invite ON family_invite_redemptions(invite_id);
CREATE INDEX idx_tasks_family_created ON tasks(family_id, created_at, id);
CREATE INDEX idx_tasks_family_updated ON tasks(family_id, updated_at, id);
UPDATE schema_metadata SET value='5', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
