// Generated from spec/openapi.json; npm run generate:auth.
export type AuthStartRequest = {"return_path":"/" | "/overview" | "/inbox" | "/activity" | "/settings"};
export type AuthCallbackQuery = {"code":string;"state":string};
export type AuthLogoutRequest = Record<string, never>;
export type MessageReference = {"kind":"task" | "artifact" | "message";"id":string};
export type MessageCreateRequest = {"recipient_agent_ids":Array<string>;"thread_id"?:string | null;"body":string;"refs":Array<MessageReference>;"artifact_ids":Array<string>};
export type AuthStartData = {"authorization_url":string};
export type AuthStartDataResponse = {"data":AuthStartData;"request_id":string};
export type AuthSession = {"actor":{"kind":"human";"principal_id":string;"agent_id":null};"csrf_token":string;"expires_at":string};
export type AuthSessionResponse = {"data":AuthSession;"request_id":string};
export type AuthLogoutData = {"logged_out":true};
export type AuthLogoutDataResponse = {"data":AuthLogoutData;"request_id":string};
export type Error = {"error":{"code":"INVALID_REQUEST" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "INVALID_STATE" | "STALE_RUN" | "APPROVAL_EXPIRED" | "CURSOR_EXPIRED" | "LIMIT_EXCEEDED" | "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR";"message":string;"retryable":boolean;"request_id":string;"details"?:{"field"?:string;"current_version"?:number;"current_proposal_version"?:number;"resource_id"?:string;"retry_after_seconds"?:number;"reason"?:string;"feature"?:"artifacts" | "tasks";"current_revision"?:number}}};
export type Actor = {"kind":"human" | "agent" | "system";"principal_id":string;"agent_id":string | null};
export type Event = {"id":string;"workspace_id":string;"sequence":number;"type":string;"actor":Actor;"resource_type":"task" | "run" | "approval" | "agent" | "runtime" | "message" | "artifact" | "credential" | "configuration" | "profile" | "preferences";"resource_id":string;"task_version":number | null;"run_id":string | null;"fence":number | null;"occurred_at":string;"summary":string;"request_id":string;"resource_version":number | null;"thread_id":string | null};
export const authReturnPaths = ["/","/overview","/inbox","/activity","/settings"] as const;
