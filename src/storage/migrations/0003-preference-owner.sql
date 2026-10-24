-- Stable opaque owner records. Rebuild only during controlled forward migration.
CREATE TABLE preferences_with_owner (
 principal_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 document_json TEXT NOT NULL CHECK(json_valid(document_json)),updated_at INTEGER NOT NULL,
 record_id TEXT NOT NULL CHECK(length(record_id)=37 AND substr(record_id,1,5)='pref_' AND substr(record_id,6) NOT GLOB '*[^a-f0-9]*')
);
CREATE UNIQUE INDEX preferences_record_id ON preferences_with_owner(record_id);
-- @preference-owner-backfill
DROP TABLE preferences;
ALTER TABLE preferences_with_owner RENAME TO preferences;
CREATE TRIGGER preferences_owner_immutable BEFORE UPDATE ON preferences
WHEN NEW.principal_id IS NOT OLD.principal_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.record_id IS NOT OLD.record_id
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREFERENCE_OWNER'); END;
CREATE TRIGGER preferences_owner_retained BEFORE DELETE ON preferences
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREFERENCE_OWNER'); END;
