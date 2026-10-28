-- Workspace-global ordered candidate streams; text and authorization predicates run after bounded seeks.
CREATE INDEX messages_created_order ON messages(workspace_id,created_at,id);
CREATE INDEX tasks_created_order ON tasks(workspace_id,created_at,id);
-- Nonunique by design: preserve legacy duplicates and fail closed in current authentication.
CREATE INDEX native_credentials_token_lookup ON native_credentials(workspace_id,token_sha256,credential_id);
