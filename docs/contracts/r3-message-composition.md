# R3 text-only message composition

Status: Partial R3 source implementation; acceptance pending; no released artifact.

## Scope and baseline

This bounded issue 55 slice consumes the green issue 53 durable draft/controller and cookie/CSRF composition client from PR127, plus the independent decision contracts in PR128. The baseline is PR128 head `8991aedef34e7bfa574645bea07236a46bb4c8d8`, tree `04bf43a05e3d6d84b0cfd363eacca5047bc50e7f`. Source work does not authorize R3 merging or R4 acceptance.

The app offers a text-only **new message** form. Recipients are selected by canonical agent ID from current authorized pages; saved IDs outside the current page stay visibly selected until deliberately removed. The server remains the authority. Browser list/get agent reads use the existing generated map and cookie lane; the feature adds no grant. Current `messages:send`, `messages:read` and `agents:read` are required. A fresh session and workspace check precedes loading a private saved draft and precedes dispatch; selected agents are individually re-read for exact ID/workspace/active status. Stale or unavailable observations do not authorize sending.

`refs` and `artifact_ids` are empty in this slice. Attachment stage/upload/commit, references, reply membership and deliberate new-thread workflows beyond new messages remain future issue 55 work. No file bytes, bearer credentials, CSRF or session tokens enter draft storage. User-entered text can itself contain sensitive material; no universal secret-free-text claim is made.

## Durable intent and truthful status

The existing IndexedDB transaction owner persists one payload/key before command handoff. Edits have their own revision. A failed save cannot dispatch an older saved payload as though it were the visible edit. Double activation shares one operation. Transport loss remains uncertain, retained across page reload, without automatic resend, guessed lookup, replacement key or wall-clock retention inference.

A successful command is **durably admitted**, not delivered, acknowledged or completed. Only the actual live success response supplies a thread link. A restored confirmed record has message ID only; it does not guess a thread ID or reissue a request to discover one. Explicit acknowledgement clears the settled intent under the existing draft-revision guard. Prepared validation failures require deliberate review before changing the frozen request; uncertain requests cannot be discarded as resolved.

The body and envelope use existing canonical limits, including 32768 UTF-8 body bytes and 65536 envelope bytes. Browser forms do not redefine admission, thread visibility or ACK semantics.

## Local privacy lifecycle

Navigation and offline transitions invalidate preparation and hide local text; online return does not submit in the background. Reopening requires fresh session verification. Logout, changed principal or rejected authority clears the remembered scoped record with a new storage epoch and invalidates stale bindings. Same-origin cross-tab messages are bounded local invalidation hints, not authentication evidence or permission to erase another principal's data.

Visible clearing is distinguished from asynchronous durable erasure. Failure remains blocked and is not reported as successful cleanup. Local erasure cannot cancel or undo a server write already sent. The stable semantic form preserves text/focus through unrelated read refreshes and renders remote labels/message text inertly.

## Evidence boundaries

Focused source tests cover generation/storage races, current-agent identity, UTF-8 limits, failed-save admission, duplicate activation, restored unknown no-send and explicit erase failure. DOM tests are structural, not layout/keyboard proof. Actual browser cases are selected by the existing spec-only Playwright configuration and run only in ordinary CI: real permitted command admission, keyboard operation, double activation, reload/IndexedDB erasure and cross-tab invalidation. The transport-abort scenario is not claimed as committed-response loss. A changed-session response fixture is a privacy race test, not a second real identity-provider login acceptance.

The isolated R2 browser fixture adds only synthetic owner `agents:read` and recipient `messages:read` needed to exercise existing command guards; product configuration and real permissions are unchanged. The restricted human fixture remains restricted. No local browser/protected fixture execution or full live issue 55 acceptance is inferred from source tests. Exact CI receipts belong to the draft PR; issue 55 remains open for the omitted flows and acceptance criteria.
