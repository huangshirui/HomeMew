CREATE TABLE events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR length(description) <= 5000),
  start_at TEXT,
  end_at TEXT,
  start_date TEXT,
  end_date TEXT,
  is_all_day INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
  timezone TEXT NOT NULL,
  location TEXT CHECK (location IS NULL OR length(location) <= 500),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id),
  CHECK (
    (is_all_day = 0 AND start_at IS NOT NULL AND end_at IS NOT NULL
      AND start_date IS NULL AND end_date IS NULL AND end_at > start_at)
    OR
    (is_all_day = 1 AND start_at IS NULL AND end_at IS NULL
      AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date)
  )
);

CREATE TABLE event_attendees (
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR length(description) <= 5000),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR (status != 'completed' AND completed_at IS NULL AND completed_by IS NULL))
);

CREATE TABLE task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_events_family_start ON events (family_id, start_at);
CREATE INDEX idx_events_family_dates ON events (family_id, start_date);
CREATE INDEX idx_events_family_status ON events (family_id, status);
CREATE INDEX idx_events_not_deleted ON events (family_id, deleted_at);
CREATE INDEX idx_event_attendees_user ON event_attendees (user_id, event_id);
CREATE INDEX idx_tasks_family_due ON tasks (family_id, due_date);
CREATE INDEX idx_tasks_family_status_due ON tasks (family_id, status, due_date);
CREATE INDEX idx_tasks_not_deleted ON tasks (family_id, deleted_at);
CREATE INDEX idx_task_assignees_user ON task_assignees (user_id, task_id);

UPDATE schema_metadata
SET value = '3', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
