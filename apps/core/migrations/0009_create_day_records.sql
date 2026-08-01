CREATE TABLE day_records (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description) <= 5000),
  kind TEXT NOT NULL CHECK(kind IN ('elapsed','countdown','cycle')),
  anchor_date TEXT NOT NULL CHECK(date(anchor_date) IS NOT NULL AND date(anchor_date)=anchor_date),
  cycle_days INTEGER CHECK(cycle_days IS NULL OR cycle_days BETWEEN 1 AND 3650),
  next_due_date TEXT CHECK(next_due_date IS NULL OR (date(next_due_date) IS NOT NULL AND date(next_due_date)=next_due_date)),
  attention_before_days INTEGER CHECK(attention_before_days IS NULL OR attention_before_days BETWEEN 0 AND 3650),
  attention_after_days INTEGER CHECK(attention_after_days IS NULL OR attention_after_days BETWEEN 1 AND 3650),
  subject_user_id TEXT REFERENCES users(id),
  icon TEXT CHECK(icon IS NULL OR length(icon) <= 50),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user','system')),
  created_by_id TEXT NOT NULL,
  updated_by_type TEXT NOT NULL CHECK(updated_by_type IN ('user','system')),
  updated_by_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  deleted_by_type TEXT CHECK(deleted_by_type IS NULL OR deleted_by_type IN ('user','system')),
  deleted_by_id TEXT,
  mutation_token TEXT,
  CHECK((deleted_by_type IS NULL)=(deleted_by_id IS NULL)),
  CHECK(
    (kind='elapsed' AND cycle_days IS NULL AND next_due_date IS NULL AND attention_before_days IS NULL)
    OR
    (kind='countdown' AND cycle_days IS NULL AND next_due_date IS NULL AND attention_after_days IS NULL)
    OR
    (kind='cycle' AND cycle_days IS NOT NULL AND next_due_date IS NOT NULL AND attention_after_days IS NULL)
  )
);

CREATE TABLE day_record_occurrences (
  id TEXT PRIMARY KEY,
  day_record_id TEXT NOT NULL REFERENCES day_records(id),
  occurred_on TEXT NOT NULL CHECK(date(occurred_on) IS NOT NULL AND date(occurred_on)=occurred_on),
  note TEXT CHECK(note IS NULL OR length(note) <= 1000),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('initial','manual')),
  recorded_by_type TEXT NOT NULL CHECK(recorded_by_type IN ('user','system')),
  recorded_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(day_record_id, occurred_on)
);

CREATE INDEX idx_day_records_family_status ON day_records(family_id,status,deleted_at);
CREATE INDEX idx_day_records_family_kind_anchor ON day_records(family_id,kind,anchor_date);
CREATE INDEX idx_day_records_family_due ON day_records(family_id,next_due_date);
CREATE INDEX idx_day_records_subject ON day_records(family_id,subject_user_id);
CREATE INDEX idx_day_records_family_created ON day_records(family_id,created_at,id);
CREATE INDEX idx_day_records_family_updated ON day_records(family_id,updated_at,id);
CREATE INDEX idx_day_occurrences_record_date ON day_record_occurrences(day_record_id,occurred_on DESC,id DESC);

UPDATE schema_metadata
SET value='9', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE key='schema_version';
