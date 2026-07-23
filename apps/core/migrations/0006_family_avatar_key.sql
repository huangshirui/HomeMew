-- Family avatars are owned by HomeMew and stored in the AVATARS R2 bucket.
-- Legacy arbitrary avatar URLs are intentionally discarded.

ALTER TABLE families DROP COLUMN avatar_url;
ALTER TABLE families ADD COLUMN avatar_key TEXT;

UPDATE schema_metadata
SET value = '6', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
