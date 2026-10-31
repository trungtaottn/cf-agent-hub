// Generated from canonical schemas.
export type DeploymentConfig = {
"contract_revision": "0.2";
"workspace_catalog": Array<{
"workspace_id": string;
"object_name": string;
}>;
"authentication": {
"mode": "verified-oidc";
"issuer": string;
"audience": string;
"allowed_origins": Array<string>;
"client_id": string;
"redirect_uris": Array<{
"workspace_id": string;
"redirect_uri": string;
}>;
"client_secret_ref": string;
"session_ttl_seconds": number;
"id_token_algorithms": ["RS256"];
"reviewed_oidc_endpoints": {
"authorization_endpoint": string;
"token_endpoint": string;
"jwks_uri": string;
};
};
"static_participants": Array<{
"workspace_id": string;
"agent_id": string;
"display_name": string;
}>;
"config_epoch": number;
"human_grants": Array<{
"workspace_id": string;
"principal_id": string;
"issuer": string;
"subject": string;
"scopes": Array<"workspace:read" | "messages:send" | "messages:read" | "messages:review" | "events:read" | "profile:edit" | "operations:read" | "tasks:read" | "tasks:create" | "tasks:edit" | "tasks:schedule" | "tasks:review" | "tasks:cancel" | "agents:read" | "agents:manage" | "credentials:manage" | "artifacts:read" | "artifacts:write" | "search:read" | "imports:manage" | "approvals:read" | "approvals:decide">;
"project_ids": (Array<string> | null);
"enabled": boolean;
"delegable_native_scopes"?: Array<"workspace:read" | "messages:send" | "messages:read" | "messages:ack" | "events:read" | "tasks:read" | "tasks:create" | "tasks:edit" | "tasks:schedule" | "tasks:claim" | "tasks:execute" | "tasks:review" | "tasks:cancel" | "agents:read" | "runtimes:manage" | "artifacts:read" | "artifacts:write" | "search:read">;
}>;
"static_credential_refs": Array<{
"workspace_id": string;
"credential_id": string;
"agent_id": string;
"scopes": Array<"workspace:read" | "messages:send" | "messages:read" | "messages:ack" | "events:read" | "tasks:read" | "tasks:create" | "tasks:edit" | "tasks:schedule" | "tasks:claim" | "tasks:execute" | "tasks:review" | "tasks:cancel" | "agents:read" | "runtimes:manage" | "artifacts:read" | "artifacts:write" | "search:read">;
"project_ids": (Array<string> | null);
"expires_at": string;
"enabled": boolean;
}>;
"workspace_policies": Array<{
"workspace_id": string;
"allowed_user_overrides": Array<"theme" | "density" | "default_view">;
"notification_destinations": Array<{
"destination_id": string;
"agent_id": string;
"url": string;
"signing_key_ref": string;
"enabled": boolean;
}>;
"retry_after_max_seconds": number;
"execution_policy"?: ExecutionPolicy;
"decision_policy"?: {
"policy_version": number;
"expiry_seconds": number;
"expiry_batch_limit": number;
"actions": Array<{
"action_id": string;
"schema_version": number;
"schema_sha256": string;
"reviewer_ids": Array<string>;
"resource_kinds": Array<string>;
}>;
};
}>;
};
export type VerificationBundle = {
"contract_revision": "0.1";
"config_epoch": number;
"config_digest": string;
"credentials": Array<{
"workspace_id": string;
"credential_id": string;
"token_sha256": string;
}>;
"retired_credentials": Array<{
"workspace_id": string;
"credential_id": string;
"agent_id": string;
"token_sha256": string;
"retired_at_epoch": number;
}>;
"auth": {
"key_id": string;
"algorithm": "HMAC-SHA256";
"tag": string;
};
};
export type ExecutionPolicy = {
"policy_version": number;
"agent_wip_limit": number;
"task_retry_limit": number;
"artifact_upload_ttl_seconds": number;
"eligibility_rules": Array<{
"project_id": (string | null);
"work_role_id": (string | null);
"eligible_agent_ids": Array<string>;
}>;
"replay_safety_rules": Array<{
"id": string;
"project_id": (string | null);
"work_role_id": (string | null);
"classification": "replay_safe";
"evidence_ref": string;
}>;
};
export type DecisionPolicy = {
"policy_version": number;
"expiry_seconds": number;
"expiry_batch_limit": number;
"actions": Array<{
"action_id": string;
"schema_version": number;
"schema_sha256": string;
"reviewer_ids": Array<string>;
"resource_kinds": Array<string>;
}>;
};
export declare function validateDecisionPolicyShape(input: unknown): input is DecisionPolicy;
export declare function validateDeployment(input: unknown): input is DeploymentConfig;
export declare function validateBundle(input: unknown): input is VerificationBundle;
export declare function validateExecutionPolicyShape(input: unknown): input is ExecutionPolicy;
