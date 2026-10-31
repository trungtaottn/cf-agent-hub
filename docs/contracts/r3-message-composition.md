# R3 message composition

Status: complete-flow source candidate; exact-head browser/full CI acceptance pending. No released artifact or merge/deployment claim.

## Scope and baseline

The original PR129 text-only slice left references, replies and attachments unimplemented. This continuation starts from PR134 head `bc9247ab6796dcae9021a40b3e6e8308aa241480`, tree `4e948996232e079b0289c5178d5251606f9a4364` (equivalent local `08e81100fc3fa9435d18451a37157a1440bdf960`). It retains the reviewed shared admission controller, exact prepared admission identity and legacy-UNKNOWN safety behavior.

The semantic form uses canonical `MessageCreateRequest`: current agent IDs, body, optional thread ID, authorized references and committed artifact IDs. No second message endpoint, membership rule or grant is introduced. Current human `messages:send`, `messages:read` and `agents:read` are required. Resource observations precede the final fresh session/workspace check: optional denied reads intentionally clear the client CSRF token, so cached tokens are never restored. Server preparation and mutation remain authoritative.

## References and replies

Task and artifact IDs are checked through current native reads; artifacts must be committed. Message references are selected from a deliberately read, currently authorized thread. A restored message-reference ID without its current thread observation remains held for review, not resolved through guesses or a new endpoint. Unavailable, foreign, stale and revoked references preserve text and block fresh admission.

Reply selection is limited to the observed sender/recipient subset from the authorized thread response. A page is not a complete membership roster, and a human with `messages:review` may read without permission to reply. The server still checks actual membership and every participant's visibility. Native rejection retains the reply draft; **Start new thread** is an explicit action that preserves text and clears recipient selection rather than silently widening the old thread. Prior history is not copied into the new message.

## Attachments and ambiguity

The browser cookie lane uses the existing generated stage/content/commit contracts, same-origin CSRF and bounded Blob content. It never supplies bearer/runtime credentials or a forbidden Content-Length header. Upload requires current `artifacts:read` and `artifacts:write`; exposing an implemented capability only intersects existing grants. Frozen native schema16 behavior remains unchanged; the fixed current17 projection has matching bounded expected output.

Files, hashes, keys and upload state are ephemeral. Only committed IDs reach durable message storage. The owner reserves count/bytes before hashing, captures detached scope and item ownership, and fences every awaited completion. Navigation/logout disposes local bytes and aborts local requests; it cannot undo an already sent server write.

- Stage-response loss stays **unknown**, with no stage retry: outcome GC could make even the same key a new allocation. Explicit abandonment removes only local state; a new upload is a new deliberate operation, not recovery.
- Upload/commit ambiguity with a known ID first reads exact current metadata. Immutable descriptor, workspace, owner and expected status/version must match. A matching committed version3 can be attached without another commit; otherwise deliberate retry retains the exact upload/commit key and body/version. Missing, inaccessible or mismatched metadata never proves noncommit.
- Selected incomplete uploads block new message admission until committed or explicitly abandoned. Text remains independent.
- Removing an upload or attachment removes local bytes/association intent only. Staged/uploaded artifacts follow existing server expiry/cleanup; committed but unassociated artifacts are not claimed automatically deleted or expired.

Independent limits are 32,768 UTF-8 body bytes, 65,536 complete JSON envelope bytes, 8,192 serialized reference bytes, 10,485,760 binary bytes per file, five distinct artifacts (including artifact references), and 26,214,400 aggregate artifact bytes. Binary bytes are not character counts or base64 sizes.

## Durable admission and privacy

One immutable prepared payload/key/handle is persisted before dispatch. Duplicate activation shares one operation; lost response stays uncertain across reload without blind resend or a replacement key. Historical lookup verifies current authority but does not reapply fresh recipient/reference admission eligibility. The server applies current visibility gates to retained evidence.

Admission is not delivery, recipient ACK or task completion. A minimal historical receipt cannot invent a current Message DTO or unknown thread ID. The actual successful message response may supply a thread link; reading that link is independently authorized. Scope changes immediately hide private state before host teardown; logout/authority erasure retains storage-failure blocking semantics and cross-tab epoch fences.

## Reproduction and evidence boundaries

Run `npm test`, `npm run typecheck`, `npm run build:ui`, `npm run verify:generated`, `python -B scripts/validate_docs.py`, affected health/native Workers suites, and `npm run test:ui -- test/ui/compose-message.spec.ts` on the exact candidate. Source tests include actual HubClient transport validation, isolated model/DOM tests, ownership/retention regressions and independent exact/+1 byte/count boundaries. Synthetic model tests are not live operator acceptance.

The browser spec uses the production app, real fixture human session/CSRF, R2 upload path and persisted SQL. Test-only fault injection consumes actual successful stage/commit/message responses before dropping them; stage/commit ambiguity is distinguished from pre-dispatch network abort. Genuine Tab/Shift+Tab traversal, invalid-submit focus, hostile text, reply/reference flow, reload/privacy and no-duplicate receipts must execute in supported CI. Local browser execution remains unavailable in this environment; listing/bundling specs is not browser acceptance. Historical local launcher/checkout guard failures are not erased by source tests. Exact CI receipts belong to the draft PR; this document does not close issue55 or declare all R3 complete.
