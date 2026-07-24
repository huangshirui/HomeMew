CREATE TABLE system_identities (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','deleted')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  deleted_at TEXT
);

CREATE TABLE family_system_access (
  family_id TEXT NOT NULL REFERENCES families(id),
  system_id TEXT NOT NULL UNIQUE REFERENCES system_identities(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  permissions TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX oauth_access_tokens_credential_idx ON oauth_access_tokens(credential_id,expires_at);

CREATE TABLE event_attendees_backup AS SELECT * FROM event_attendees;
DROP TABLE event_attendees;
ALTER TABLE events RENAME TO events_legacy;
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description)<=5000),
  start_at TEXT,end_at TEXT,start_date TEXT,end_date TEXT,
  is_all_day INTEGER NOT NULL CHECK(is_all_day IN (0,1)),
  timezone TEXT NOT NULL,
  location TEXT CHECK(location IS NULL OR length(location)<=500),
  created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user','system')),
  created_by_id TEXT NOT NULL,
  updated_by_type TEXT NOT NULL CHECK(updated_by_type IN ('user','system')),
  updated_by_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by_type TEXT CHECK(deleted_by_type IS NULL OR deleted_by_type IN ('user','system')),
  deleted_by_id TEXT,
  mutation_token TEXT,
  CHECK((deleted_by_type IS NULL)=(deleted_by_id IS NULL)),
  CHECK((is_all_day=0 AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL AND end_at>start_at)
    OR (is_all_day=1 AND start_at IS NULL AND end_at IS NULL AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date>start_date))
);
INSERT INTO events(id,family_id,summary,description,start_at,end_at,start_date,end_date,is_all_day,timezone,location,created_by_type,created_by_id,updated_by_type,updated_by_id,status,version,created_at,updated_at,deleted_at,deleted_by_type,deleted_by_id,mutation_token)
SELECT id,family_id,summary,description,start_at,end_at,start_date,end_date,is_all_day,timezone,location,'user',created_by,'user',updated_by,status,version,created_at,updated_at,deleted_at,CASE WHEN deleted_by IS NULL THEN NULL ELSE 'user' END,deleted_by,mutation_token FROM events_legacy;
DROP TABLE events_legacy;
CREATE TABLE event_attendees(event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(event_id,user_id));
INSERT INTO event_attendees SELECT * FROM event_attendees_backup;
DROP TABLE event_attendees_backup;
CREATE INDEX idx_events_family_start ON events(family_id,start_at);
CREATE INDEX idx_events_family_dates ON events(family_id,start_date);
CREATE INDEX idx_events_family_status ON events(family_id,status);
CREATE INDEX idx_events_not_deleted ON events(family_id,deleted_at);
CREATE INDEX idx_event_attendees_user ON event_attendees(user_id,event_id);

CREATE TABLE task_assignees_backup AS SELECT * FROM task_assignees;
DROP TABLE task_assignees;
ALTER TABLE tasks RENAME TO tasks_legacy;
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by_type TEXT CHECK(deleted_by_type IS NULL OR deleted_by_type IN ('user','system')),
  deleted_by_id TEXT,
  mutation_token TEXT,
  CHECK((completed_by_type IS NULL)=(completed_by_id IS NULL)),
  CHECK((deleted_by_type IS NULL)=(deleted_by_id IS NULL)),
  CHECK((status='completed' AND completed_at IS NOT NULL AND completed_by_id IS NOT NULL) OR (status!='completed' AND completed_at IS NULL AND completed_by_id IS NULL))
);
INSERT INTO tasks(id,family_id,name,description,due_date,status,completed_at,completed_by_type,completed_by_id,created_by_type,created_by_id,updated_by_type,updated_by_id,version,created_at,updated_at,deleted_at,deleted_by_type,deleted_by_id,mutation_token)
SELECT id,family_id,name,description,due_date,status,completed_at,CASE WHEN completed_by IS NULL THEN NULL ELSE 'user' END,completed_by,'user',created_by,'user',updated_by,version,created_at,updated_at,deleted_at,CASE WHEN deleted_by IS NULL THEN NULL ELSE 'user' END,deleted_by,mutation_token FROM tasks_legacy;
DROP TABLE tasks_legacy;
CREATE TABLE task_assignees(task_id TEXT NOT NULL REFERENCES tasks(id),user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(task_id,user_id));
INSERT INTO task_assignees SELECT * FROM task_assignees_backup;
DROP TABLE task_assignees_backup;
CREATE INDEX idx_tasks_family_due ON tasks(family_id,due_date);
CREATE INDEX idx_tasks_family_status_due ON tasks(family_id,status,due_date);
CREATE INDEX idx_tasks_not_deleted ON tasks(family_id,deleted_at);
CREATE INDEX idx_task_assignees_user ON task_assignees(user_id,task_id);
CREATE INDEX idx_tasks_family_created ON tasks(family_id,created_at,id);
CREATE INDEX idx_tasks_family_updated ON tasks(family_id,updated_at,id);

UPDATE schema_metadata SET value='7',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
