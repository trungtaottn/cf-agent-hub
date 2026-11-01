// Generated from spec/openapi.json; npm run generate:auth.
import * as validators from "./auth-validators.js";
export const httpSchemas = {
"TaskRequestDecisionRequest":{validate:validators.validateTaskRequestDecisionRequest,byteRules:[]},
"ApprovalDecisionRequest":{validate:validators.validateApprovalDecisionRequest,byteRules:[]},
"AuthStartRequest":{validate:validators.validateAuthStartRequest,byteRules:[]},
"AuthCallbackQuery":{validate:validators.validateAuthCallbackQuery,byteRules:[]},
"AuthLogoutRequest":{validate:validators.validateAuthLogoutRequest,byteRules:[]},
"MessageCreateRequest":{validate:validators.validateMessageCreateRequest,byteRules:[{"path":["body"],"encoding":"utf8","maxBytes":32768},{"path":["refs"],"encoding":"json","maxBytes":8192}]},
"MessageAckRequest":{validate:validators.validateMessageAckRequest,byteRules:[]},
"ProfileWriteRequest":{validate:validators.validateProfileWriteRequest,byteRules:[]},
"PreferencesWriteRequest":{validate:validators.validatePreferencesWriteRequest,byteRules:[]},
"CatalogPreviewRequest":{validate:validators.validateCatalogPreviewRequest,byteRules:[]},
"CatalogApplyRequest":{validate:validators.validateCatalogApplyRequest,byteRules:[]},
"ImportApplyRequest":{validate:validators.validateImportApplyRequest,byteRules:[]},
"TaskCreateRequest":{validate:validators.validateTaskCreateRequest,byteRules:[]},
"TaskPatchRequest":{validate:validators.validateTaskPatchRequest,byteRules:[]},
"TaskVersionRequest":{validate:validators.validateTaskVersionRequest,byteRules:[]},
"TaskReasonRequest":{validate:validators.validateTaskReasonRequest,byteRules:[]},
"TaskClaimRequest":{validate:validators.validateTaskClaimRequest,byteRules:[]},
"TaskSubmitResultRequest":{validate:validators.validateTaskSubmitResultRequest,byteRules:[]},
"TaskFailRequest":{validate:validators.validateTaskFailRequest,byteRules:[]},
"RunHeartbeatRequest":{validate:validators.validateRunHeartbeatRequest,byteRules:[]},
"AgentCreateRequest":{validate:validators.validateAgentCreateRequest,byteRules:[]},
"AgentPatchRequest":{validate:validators.validateAgentPatchRequest,byteRules:[]},
"AgentArchiveRequest":{validate:validators.validateAgentArchiveRequest,byteRules:[]},
"RuntimeCreateRequest":{validate:validators.validateRuntimeCreateRequest,byteRules:[]},
"RuntimeHeartbeatRequest":{validate:validators.validateRuntimeHeartbeatRequest,byteRules:[]},
"ArtifactStageRequest":{validate:validators.validateArtifactStageRequest,byteRules:[]},
"ArtifactCommitRequest":{validate:validators.validateArtifactCommitRequest,byteRules:[]},
"CredentialCreateRequest":{validate:validators.validateCredentialCreateRequest,byteRules:[]},
"CredentialRevokeRequest":{validate:validators.validateCredentialRevokeRequest,byteRules:[]},
"ImportEnvelope":{validate:validators.validateImportEnvelope,byteRules:[]},
"ObservationEstablishRequest":{validate:validators.validateObservationEstablishRequest,byteRules:[]},
"ObservationBatchRequest":{validate:validators.validateObservationBatchRequest,byteRules:[{"path":["records","*","relative_path"],"encoding":"utf8","maxBytes":1024},{"path":["records","*","label"],"encoding":"utf8","maxBytes":512}]},
"ObservationReplaceRequest":{validate:validators.validateObservationReplaceRequest,byteRules:[]}
} as const;
export type HttpSchemaName=keyof typeof httpSchemas;
export const httpFieldNames = ["Location","accent","accept_rejected_rows","accepted_at","acknowledged_at","acknowledged_ids","action","active_run_id","activity","actor","adapter_id","adapter_version","admission_id","affected_agent_ids","affected_task_ids","after","agent_id","agent_version","allowed_user_overrides","already_acknowledged_ids","applied_at","approval","approval_id","approval_version","artifact_id","artifact_ids","artifact_version","assigned_agent_id","assigned_human_principal_ids","authorization_url","base_revision","before","binding","body","branding","byte_size","changes","checked_at","checkout_slot_id","checkpoint","checks","code","committed_at","completeness","config_epoch","configured_events","conflict","conflicts","contract_revision","counts","coverage","create","created","created_at","credential","credential_version","csrf_token","current_proposal_version","current_revision","current_version","cursor","data","decided_at","decided_by","decision_reason","default_view","default_view_fallback_reason","delivery_id","density","description","details","display_name","disposition","document_id","effective","effective_scopes","enabled_features","ended_at","entity_id","error","established_at","event_id","expected_agent_version","expected_approval_version","expected_artifact_version","expected_credential_version","expected_high_water","expected_import_version","expected_preferences_revision","expected_profile_revision","expected_proposal_version","expected_run_version","expected_runtime_version","expected_session_id","expected_version","expires_at","external_id","failed_count","feature","fence","field","filename","first_sequence","flags","framework","has_more","high_water","id","import_id","import_version","in_flight_count","included_categories","index","inputs","kind","label","last_error_code","last_run_at","last_seen_at","last_sequence","latest_batch_receipt","latest_replacement_receipt","latest_run_id","lease_expires_at","limit","logged_out","media_type","message","message_id","message_ids","model","name","navigation","new_epoch","new_session_id","next_cursor","next_due_at","observed_at","occurred_at","old_session_id","oldest_due_at","operation","outbox","outcome_unknown","owner","page","payload_version","pending_count","preferences","preferences_revision","presence_expires_at","preview_id","preview_sha256","principal_id","profile","profile_id","profile_revision","project_id","project_ids","projects","proposal","proposal_version","provenance","publish","read_at","readiness","ready","reason","received","recipient_agent_id","recipient_agent_ids","record_count","records","refs","rejected","relative_path","replacement_id","replacement_request_id","reported","reported_loss","repository_id","request_fingerprint","request_id","requested_by","requested_change","resource_id","resource_ids","resource_kind","resource_type","resource_version","result","retained_range","retry_after_seconds","retry_count","retry_limit","retryable","return_path","revealed","revoked_at","rows","run","run_id","run_version","runtime","runtime_instance_id","runtime_token","runtime_version","scheduler","schema_version","scope","scopes","sender","sequence","server_received_at","session_epoch","session_id","sha256","snippet","source_namespace","source_oid","source_ref","source_revision","source_sha256","source_state","source_updated_at","started_at","state","status","submitted_at","submitted_by","summary","suppressed_count","task","task_id","task_version","task_version_at_request","theme","thread_id","title","token","truncated","type","unchanged","updated_at","visible_views","work_role_id","work_role_ids","work_roles","workspace_id"] as const;
