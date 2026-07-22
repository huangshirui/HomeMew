-- User avatars are owned by HomeMew and stored in the AVATARS R2 bucket.
-- No production user data exists, so legacy arbitrary avatar URLs are discarded.

ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users ADD COLUMN avatar_key TEXT;
