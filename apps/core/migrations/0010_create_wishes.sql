CREATE TABLE wishes (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
  description TEXT CHECK(description IS NULL OR length(description) <= 5000),
  desired_date TEXT CHECK(desired_date IS NULL OR (date(desired_date) IS NOT NULL AND date(desired_date)=desired_date)),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','fulfilled','archived')),
  claimant_user_id TEXT REFERENCES users(id),
  claimed_at TEXT,
  fulfilled_by_user_id TEXT REFERENCES users(id),
  fulfilled_at TEXT,
  archived_from_status TEXT CHECK(archived_from_status IS NULL OR archived_from_status IN ('open','claimed','fulfilled')),
  created_by_type TEXT NOT NULL CHECK(created_by_type='user'),
  created_by_id TEXT NOT NULL,
  updated_by_type TEXT NOT NULL CHECK(updated_by_type='user'),
  updated_by_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  deleted_by_type TEXT CHECK(deleted_by_type IS NULL OR deleted_by_type='user'),
  deleted_by_id TEXT,
  CHECK((claimant_user_id IS NULL)=(claimed_at IS NULL)),
  CHECK((fulfilled_by_user_id IS NULL)=(fulfilled_at IS NULL)),
  CHECK((deleted_by_type IS NULL)=(deleted_by_id IS NULL)),
  CHECK(
    (status='open' AND claimant_user_id IS NULL AND fulfilled_by_user_id IS NULL AND archived_from_status IS NULL)
    OR (status='claimed' AND claimant_user_id IS NOT NULL AND fulfilled_by_user_id IS NULL AND archived_from_status IS NULL)
    OR (status='fulfilled' AND fulfilled_by_user_id IS NOT NULL AND archived_from_status IS NULL)
    OR (status='archived' AND archived_from_status IS NOT NULL)
  )
);

CREATE INDEX idx_wishes_family_status ON wishes(family_id,status,deleted_at);
CREATE INDEX idx_wishes_family_owner ON wishes(family_id,owner_user_id,status);
CREATE INDEX idx_wishes_family_claimant ON wishes(family_id,claimant_user_id,status);
CREATE INDEX idx_wishes_family_desired ON wishes(family_id,desired_date,id);
CREATE INDEX idx_wishes_family_created ON wishes(family_id,created_at,id);

UPDATE schema_metadata
SET value='10', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE key='schema_version';
