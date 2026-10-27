-- Current message participant eligibility must not scan retained credential history.
-- This index narrows candidates only; credentialGrantAllowed remains authority.
CREATE INDEX credentials_live_read
 ON native_credentials(workspace_id,agent_id,config_epoch,expires_at,credential_id)
 WHERE enabled=1 AND retired_at_epoch IS NULL AND revoked_at IS NULL;
