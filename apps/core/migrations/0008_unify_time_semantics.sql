-- HomeMew has not launched and all existing records are demo data.
-- Rebuild the business schema so every textual instant uses canonical UTC.

DROP TRIGGER IF EXISTS consume_family_invite_after_redemption;

DROP TABLE oauth_access_tokens;
DROP TABLE oauth_rate_limits;
DROP TABLE system_credentials;
DROP TABLE family_system_access;
DROP TABLE system_identities;
DROP TABLE task_assignees;
DROP TABLE tasks;
DROP TABLE event_attendees;
DROP TABLE events;
DROP TABLE family_invite_redemptions;
DROP TABLE family_invites;
DROP TABLE family_members;
DROP TABLE families;
DROP TABLE users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_from TEXT NOT NULL CHECK(created_from IN ('wechat_miniprogram','wecom','admin','other')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  avatar_key TEXT
);

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  avatar_key TEXT
);
CREATE INDEX families_created_by_status_idx ON families(created_by,status);

CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at TEXT,
  removed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(family_id,user_id)
);
CREATE INDEX family_members_family_status_idx ON family_members(family_id,status);
CREATE INDEX family_members_user_status_idx ON family_members(user_id,status);

CREATE TABLE family_invites (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','exhausted','expired','revoked')),
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL CHECK(max_uses>0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0 AND used_count<=max_uses),
  created_by TEXT NOT NULL REFERENCES users(id),
  revoked_by TEXT REFERENCES users(id),
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX family_invites_family_status_idx ON family_invites(family_id,status);

CREATE TABLE family_invite_redemptions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES family_invites(id),
  family_id TEXT NOT NULL REFERENCES families(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  redeemed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER consume_family_invite_after_redemption
AFTER INSERT ON family_invite_redemptions
BEGIN
  UPDATE family_invites
  SET used_count=used_count+1,
      status=CASE WHEN used_count+1>=max_uses THEN 'exhausted' ELSE status END,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=NEW.invite_id;
END;
CREATE INDEX idx_invite_redemptions_invite ON family_invite_redemptions(invite_id);

CREATE TABLE system_identities (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description)<=500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','deleted')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  deleted_at TEXT
);

CREATE TABLE family_system_access (
  family_id TEXT NOT NULL REFERENCES families(id),
  system_id TEXT NOT NULL UNIQUE REFERENCES system_identities(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  permissions TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(family_id,system_id)
);

CREATE TABLE system_credentials (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES system_identities(id),
  credential_type TEXT NOT NULL CHECK(credential_type IN ('oauth_client_secret','api_token')),
  secret_hash TEXT NOT NULL UNIQUE,
  secret_suffix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);
CREATE INDEX system_credentials_system_idx ON system_credentials(system_id,status);

CREATE TABLE oauth_rate_limits (
  dimension TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  PRIMARY KEY(dimension,subject)
);

CREATE TABLE oauth_access_tokens (
  jti TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES system_identities(id),
  credential_id TEXT NOT NULL REFERENCES system_credentials(id),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX oauth_access_tokens_credential_idx ON oauth_access_tokens(credential_id,expires_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description)<=5000),
  start_at TEXT,
  end_at TEXT,
  start_date TEXT,
  end_date TEXT,
  is_all_day INTEGER NOT NULL CHECK(is_all_day IN (0,1)),
  start_timezone TEXT,
  end_timezone TEXT,
  location TEXT CHECK(location IS NULL OR length(location)<=500),
  created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user','system')),
  created_by_id TEXT NOT NULL,
  updated_by_type TEXT NOT NULL CHECK(updated_by_type IN ('user','system')),
  updated_by_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  deleted_by_type TEXT CHECK(deleted_by_type IS NULL OR deleted_by_type IN ('user','system')),
  deleted_by_id TEXT,
  mutation_token TEXT,
  CHECK((deleted_by_type IS NULL)=(deleted_by_id IS NULL)),
  CHECK(
    (is_all_day=0
      AND start_at IS NOT NULL AND end_at IS NOT NULL
      AND start_date IS NULL AND end_date IS NULL
      AND end_at>start_at)
    OR
    (is_all_day=1
      AND start_at IS NULL AND end_at IS NULL
      AND start_date IS NOT NULL AND end_date IS NOT NULL
      AND start_timezone IS NULL AND end_timezone IS NULL
      AND end_date>start_date)
  )
);
CREATE INDEX idx_events_family_start ON events(family_id,start_at);
CREATE INDEX idx_events_family_dates ON events(family_id,start_date);
CREATE INDEX idx_events_family_status ON events(family_id,status);
CREATE INDEX idx_events_not_deleted ON events(family_id,deleted_at);

CREATE TABLE event_attendees (
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX idx_event_attendees_user ON event_attendees(user_id,event_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description)<=5000),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
  completed_at TEXT,
  completed_by_type TEXT CHECK(completed_by_type IS NULL OR completed_by_type IN ('user','system')),
  completed_by_id TEXT,
  created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user','system')),
  created_by_id TEXT NOT NULL,
  updated_by_type TEXT NOT NULL CHECK(updated_by_type IN ('user','system')),
  updated_by_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  deleted_by_type TEXT CHECK(deleted_by_type IS NULL OR deleted_by_type IN ('user','system')),
  deleted_by_id TEXT,
  mutation_token TEXT,
  CHECK((completed_by_type IS NULL)=(completed_by_id IS NULL)),
  CHECK((deleted_by_type IS NULL)=(deleted_by_id IS NULL)),
  CHECK(
    (status='completed' AND completed_at IS NOT NULL AND completed_by_id IS NOT NULL)
    OR
    (status!='completed' AND completed_at IS NULL AND completed_by_id IS NULL)
  )
);
CREATE INDEX idx_tasks_family_due ON tasks(family_id,due_date);
CREATE INDEX idx_tasks_family_status_due ON tasks(family_id,status,due_date);
CREATE INDEX idx_tasks_not_deleted ON tasks(family_id,deleted_at);
CREATE INDEX idx_tasks_family_created ON tasks(family_id,created_at,id);
CREATE INDEX idx_tasks_family_updated ON tasks(family_id,updated_at,id);

CREATE TABLE task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(task_id,user_id)
);
CREATE INDEX idx_task_assignees_user ON task_assignees(user_id,task_id);

UPDATE schema_metadata
SET value='8',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE key='schema_version';
