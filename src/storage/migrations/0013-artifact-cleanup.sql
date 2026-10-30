ALTER TABLE artifacts ADD COLUMN expiry_check_at INTEGER
 CHECK(expiry_check_at IS NULL OR (typeof(expiry_check_at)='integer' AND expiry_check_at BETWEEN 0 AND 8640000000000000));
UPDATE artifacts SET expiry_check_at=expires_at WHERE status IN ('staged','uploaded') AND typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 8640000000000000;
CREATE INDEX artifact_expiry_checks ON artifacts(workspace_id,expiry_check_at,id) WHERE expiry_check_at IS NOT NULL;
CREATE INDEX result_artifact_reverse ON result_artifacts(workspace_id,artifact_id,result_id);
CREATE INDEX message_artifact_reverse ON message_artifacts(workspace_id,artifact_id,message_id);
-- Cleanup scheduling does not create effect completion or revive admission.
ALTER TABLE artifact_generations ADD COLUMN cleanup_next_at INTEGER
 CHECK(cleanup_next_at IS NULL OR (typeof(cleanup_next_at)='integer' AND cleanup_next_at BETWEEN 0 AND 8640000000000000));
ALTER TABLE artifact_generations ADD COLUMN cleanup_error_code TEXT
 CHECK(cleanup_error_code IS NULL OR cleanup_error_code IN ('PUT_UNCERTAIN','DELETE_UNCERTAIN','RETAINED_REFERENCE','UNKNOWN_GENERATION','RECOVERY_COVERAGE_UNKNOWN'));
ALTER TABLE artifact_generations ADD COLUMN delete_admission_epoch INTEGER
 CHECK(delete_admission_epoch IS NULL OR (typeof(delete_admission_epoch)='integer' AND delete_admission_epoch BETWEEN 1 AND 9007199254740991));
ALTER TABLE artifact_generations ADD COLUMN delete_admission_generation INTEGER
 CHECK((delete_admission_epoch IS NULL)=(delete_admission_generation IS NULL))
 CHECK(delete_admission_generation IS NULL OR (typeof(delete_admission_generation)='integer' AND delete_admission_generation BETWEEN 0 AND 9007199254740991));
UPDATE artifact_generations SET cleanup_next_at=expires_at WHERE state<>'committed' AND typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 8640000000000000;
UPDATE artifact_generations SET cleanup_error_code='UNKNOWN_GENERATION' WHERE state<>'committed' AND cleanup_next_at IS NULL;
CREATE INDEX artifact_cleanup_due ON artifact_generations(workspace_id,cleanup_next_at,id) WHERE cleanup_next_at IS NOT NULL;
CREATE INDEX artifact_undrained_effects ON artifact_generations(workspace_id,id) WHERE effect_state IN ('in_flight','uncertain');
CREATE TABLE artifact_inventory_state (
 id INTEGER PRIMARY KEY CHECK(id=1),workspace_id TEXT NOT NULL UNIQUE,
 cursor TEXT CHECK(cursor IS NULL OR length(CAST(cursor AS BLOB)) BETWEEN 1 AND 4096),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991),
 next_due_at INTEGER NOT NULL CHECK(typeof(next_due_at)='integer' AND next_due_at BETWEEN 0 AND 8640000000000000),
 last_scan_at INTEGER CHECK(last_scan_at IS NULL OR (typeof(last_scan_at)='integer' AND last_scan_at BETWEEN 0 AND 8640000000000000)),
 observed_objects INTEGER NOT NULL DEFAULT 0 CHECK(typeof(observed_objects)='integer' AND observed_objects BETWEEN 0 AND 9007199254740991),
 orphan_observations INTEGER NOT NULL DEFAULT 0 CHECK(typeof(orphan_observations)='integer' AND orphan_observations BETWEEN 0 AND 9007199254740991),
 last_error_code TEXT CHECK(last_error_code IS NULL OR last_error_code IN ('INVENTORY_FAILED','INVENTORY_INVALID'))
);
