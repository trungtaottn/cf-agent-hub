-- Unknown historical admission is deliberately not inferred from today's authority.
ALTER TABLE artifacts ADD COLUMN admission_generation INTEGER CHECK(admission_generation IS NULL OR admission_generation>=0);
ALTER TABLE artifact_generations ADD COLUMN artifact_version INTEGER CHECK(artifact_version IS NULL OR artifact_version>=1);
-- Permanent upload scope identity survives advancement of the current effect slot to delete.
ALTER TABLE artifact_generations ADD COLUMN upload_idempotency_sha256 TEXT CHECK(upload_idempotency_sha256 IS NULL OR (length(upload_idempotency_sha256)=64 AND upload_idempotency_sha256 NOT GLOB '*[^0-9a-f]*'));
CREATE UNIQUE INDEX artifact_upload_identity ON artifact_generations(workspace_id,upload_idempotency_sha256);
CREATE INDEX artifacts_created_order ON artifacts(workspace_id,status,created_at,id);
CREATE INDEX artifacts_task_created_order ON artifacts(workspace_id,status,task_id,created_at,id);
