# Bounded command and event boundary

The Task 5 framework registers no domain HTTP route. Domain owners select a route in the owned WorkspaceDO and pass its actual AuthWorkspace to dispatchCommand. Neither a public request nor a caller-supplied JSON identity constructs that workspace, an actor, a transaction or a command descriptor. Operator installation remains on its separate authenticated control path and operator.install receipt namespace.

## Canonical HTTP input

src/http/bounds.ts exports parseBoundedJson(request: Request, schema: HttpSchemaName): Promise<unknown>. It requires JSON, counts actual streamed bytes, cancels immediately above 65,536 bytes, decodes UTF-8 strictly, then applies the generated closed schema. Content-Length never authorizes additional bytes or rejects a smaller valid actual stream. The schema's generated custom byte rules independently enforce decoded message body 32,768 bytes and canonical references 8,192 bytes; each exact boundary is accepted by its own limit check.

scripts/generate-auth-contract.mjs owns the existing canonical generation path. Its inputs list controls request validators and byte rules; its roots list controls DTO aliases; validated controls additional response/event validators. It generates src/http/dto.ts, src/http/generated/auth-validators.{js,d.ts} and src/http/generated/http-schemas.ts from spec/openapi.json. Closed empty objects emit Record<string, never>. Do not hand edit generated files or create an independent settings/error schema. Task 6 adds its canonical settings roots/inputs here and regenerates after its R-X schema amendments.

## Prepared authentication and dispatch

src/http/router.ts exports:

~~~ts
interface CommandRoute<B,T> {
 method: string;
 path: string;
 schema: HttpSchemaName;
 query(params: URLSearchParams): unknown;
 command: CommandDescriptor<B,T>;
}
dispatchCommand<B,T>(
 request: Request, workspace: AuthWorkspace, route: CommandRoute<B,T>
): Promise<Response>;
~~~

The method/path are the canonical route selected by trusted code. query validates and returns semantic JSON query values before fingerprinting; it must reject unsupported/duplicate parameters and preserve meaningful order. It must not supply a raw URL, headers, proofs, default-filled request body or current credential identity as canonical intent.

Dispatch generates a server UUID for each attempt and ignores caller correlation headers. It parses canonical request data, rejects a mixed bearer/session lane, prepares native bearer or human session verification through the existing auth exports, and requires current same-origin human CSRF. Hashing/HMAC and fingerprint await complete before executeCommand. The owned context carries admissionEpoch from the same installed snapshot that admitted URL/Origin/CORS. The effect transaction requires that exact epoch before replay lookup or writes; a configuration change during preparation rejects the in-flight attempt. A fresh independently prepared request can create/replay under the new current policy with the same still-authorized credential. It returns the exact shared data/request_id or error envelope with no-store/security headers. Domain owners remain responsible for route selection and any route-specific method/CORS negotiation; the framework does not expose speculative routes.

fingerprintRequest(method, path, query, body): Promise<string> canonicalizes original validated JSON: object key order is ignored, array order is preserved, omitted fields differ from explicit null, and method is uppercase. Unsupported/nonfinite/cyclic/sparse non-JSON intent rejects before SQL. The bootstrap installation digest is unchanged and is a different protocol.

## One synchronous effect transaction

src/workspace/commands.ts exports:

~~~ts
interface CommandOutcome<T> { status: number; data: T; }
interface CommandExecutionContext {
 workspace: AuthWorkspace;
 requestId: string;
 idempotencyKey: string;
 fingerprint: string;
 admissionEpoch: number;
}
interface CommandDescriptor<B,T> {
 operation: string;
 target: string;
 resource(tx, ctx, body): ResourceAccess | undefined;
 checkAccess(tx, ctx, body): undefined;
 checkReplay(tx, ctx, body, outcome: CommandOutcome<T>): undefined;
 execute(tx, ctx, body): { outcome: CommandOutcome<T>; event: EventDraft };
}
executeCommand<B,T>(
 ctx: CommandExecutionContext, identity: VerifiedIdentity,
 command: CommandDescriptor<B,T>, body: B
): CommandOutcome<T>;
~~~

All descriptor callbacks receive WorkspaceTransaction and the current CommandContext. Only internal trusted code constructs these descriptors or prepared contexts. Public HTTP cannot serialize a proof, actor or admission epoch into this interface. admissionEpoch must be the installed epoch read when the route's current HTTP admission policy was checked, never a public header/body value or a new epoch silently substituted after preparation.

The wrapper owns withTransaction. It samples workspace.clock.nowMs() at entry after awaits, checks actual workspace mapping/admission/maintenance, resolves identity against current installed authority, authorizes the operation and resource, then calls checkAccess before replay lookup. No nested transaction, Promise, network, crypto await or R2 operation belongs in a callback. Access/replay guards must synchronously return undefined or throw. Use a block with no return value for a successful guard; do not return the void result of another function. TypeScript rejects async, Promise and thenable guard implementations. Every descriptor callback result (resource, checkAccess, checkReplay and execute) is also checked at runtime: a thenable triggers INTERNAL_ERROR and transaction rollback, with rejection consumed outside any SQL await. Non-undefined guard results fail closed as well.

resource and checkAccess enforce current resource relationships/ownership on every attempt. checkReplay verifies current visibility of the original returned resource before any original result is returned. All first-execution revision/CAS/business preconditions belong in execute, which is skipped on a valid replay. Never move revision checks into checkAccess or checkReplay. A replacement native credential can replay for its same principal only with current scopes and visibility. Revoked/expired sessions and removed credentials cannot replay.

The handler's execute writes domain rows and any outbox rows and returns authoritative JSON domain data plus stable event resource fields. It does not append the accepted event or store an outcome itself. The wrapper appends exactly one event and stores outcome data/status/original request/event linkage in the same transaction. A failure at any point, including after event insertion, rolls all of those writes back. The handler must return its typed public domain result, never a request/header/credential dump or a response-attempt envelope.

Domain operations use physical operation keys domain.<scope>, scoped by current principal, operation, target and idempotency key. Changed fingerprints return 409 IDEMPOTENCY_CONFLICT. An original replay returns stored status/data with a fresh HTTP request_id and a bounded diagnostic linking original_request_id/event_id. It creates no second accepted event or outbox row.

src/workspace/idempotency.ts exports cleanupCompletedOutcomes(tx, workspaceId, nowMs): void. It only removes domain.* rows strictly after expires_at. Rows are retained at least 86,400,000 milliseconds and remain replayable at the exact 24-hour boundary, including after DO restart. No expiry or cleanup claims that an external effect is safe to repeat. Operator receipts are never removed by this cleanup.

## Redacted events and current visibility

EventDraft permits only type, resourceType, resourceId, resourceVersion and threadId. The current domain categories are message.accepted, message.acknowledged, profile.updated and preferences.updated. No message body, header, arbitrary summary, endpoint, proof or verification digest belongs in event input. The wrapper supplies a server-created event ID, current actor, workspace, original request ID and time.

appendEvent(tx, event: RedactedEventInput): { id: string; sequence: number } reconstructs the canonical public Event, uses fixed summaries, validates the canonical Event schema and appends it synchronously. Profile/preferences require a human actor and positive versions; profile resource ID equals workspace ID. It uses the existing event sequence allocation. Existing operator configuration event production remains separate.

projectEvent(tx, actor, id, nowMs, visibility): Event | null first refreshes current actor authority, then requires events:read, finds the row only within that workspace, and calls the mandatory resource visibility predicate with current grants. A missing/invisible row returns null before any ID or summary is projected. It has no permissive default. src/auth/authorize.ts adds refreshActor(tx, actor, nowMs): ActorContext by extracting the same existing current-actor check used by authorize; authorize retains its void signature and scope/resource policy.

The resource predicate must join actual persisted resources and recheck the relevant underlying read authorization, including project scope. Task 6 owns its stable preference-record owner mapping and owner-only predicate. Task 7/8 own persisted message/thread visibility. A predicate must not infer ownership from a resource-ID slug or treat events:read as underlying resource access.

src/audit/redact.ts emits bounded fixed-category security diagnostics with server correlation and a verified actor only when available. Replay diagnostics contain only original/current request IDs and event linkage. No unauthenticated failure appends a workspace event. src/http/envelopes.ts maps typed server errors to fixed messages and permits only canonical field pointers, supported feature categories and schema-valid numeric details. Arbitrary exception messages, stacks, reason strings, resource strings, tokens, cookies and validation dumps are not reflected. Numeric detail constraints continue to derive from the generated Error schema so Task 6's revision-zero correction follows automatically.
