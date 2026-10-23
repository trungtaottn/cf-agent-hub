// Generated from spec/openapi.json; npm run generate:auth.
export type AuthStartRequest = {"return_path":"/" | "/overview" | "/inbox" | "/activity" | "/settings"};
export type AuthCallbackQuery = {"code":string;"state":string};
export type AuthLogoutRequest = {};
export type AuthStartData = {"authorization_url":string};
export type AuthStartDataResponse = {"data":AuthStartData;"request_id":string};
export type AuthSession = {"actor":{"kind":"human";"principal_id":string;"agent_id":null};"csrf_token":string;"expires_at":string};
export type AuthSessionResponse = {"data":AuthSession;"request_id":string};
export type AuthLogoutData = {"logged_out":true};
export type AuthLogoutDataResponse = {"data":AuthLogoutData;"request_id":string};
export type Error = {"error":{"code":"INVALID_REQUEST" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "INVALID_STATE" | "STALE_RUN" | "APPROVAL_EXPIRED" | "CURSOR_EXPIRED" | "LIMIT_EXCEEDED" | "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR";"message":string;"retryable":boolean;"request_id":string;"details"?:{"field"?:string;"current_version"?:number;"current_proposal_version"?:number;"resource_id"?:string;"retry_after_seconds"?:number;"reason"?:string;"feature"?:"artifacts" | "tasks";"current_revision"?:number}}};
export const authReturnPaths = ["/","/overview","/inbox","/activity","/settings"] as const;
