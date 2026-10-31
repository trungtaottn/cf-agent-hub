# R3 browser draft and submission identity

Status: source implementation under review; browser integration and acceptance pending; no released artifact.

This bounded [issue53](https://github.com/trungtaottn/cf-agent-hub/issues/53) slice consumes [the native/source handoff](r3-handoff.md). It does not activate decisions, MCP or automatic replay after restart. Form integration remains separately scoped to issues55/56. The R2 source baseline remains distinct from deferred acceptance.

## Browser lane, not native credentials

`HubClient.compose` exposes only `createMessage` and `createTask`, using the existing canonical request/response schemas and transport. It sends same-origin cookies, in-memory CSRF and an explicit frozen idempotency key once. Unknown operations/options, caller headers, native proof/provider fields and malformed bodies are denied before fetch. The existing four-command browser task surface is unchanged. The original issue's generic NativeInvoker wording does not authorize bearer-native credentials in browser forms.

`DraftStore` and `SubmitController` accept a trusted host's current verified workspace/principal binding. Stored scope, generations and schema-valid references never authenticate a user. Server current authorization and complete resource checks remain authoritative. The host revalidation hook must reread current session/workspace and relevant references; it cannot treat stored grants or labels as permission. Forms and their concrete app lifecycle wiring belong to issues55/56.

## What is persisted

The fixed IndexedDB database `cfhub-composition-v1` stores one closed version2 record per workspace/principal. It contains a storage epoch, editable draft slots and immutable submission intents. Only canonical text/reference body fields, operation, local draft revision, idempotency key, state and minimal confirmed entity identity are retained. No session/CSRF/bearer/runtime tokens, transport options, complete responses or raw attachment bytes are stored by these owners. User-entered free text can itself be sensitive; this is not encryption or a claim that arbitrary text contains no secrets.

Local capacity is explicitly64 draft slots and8MiB per scoped record; each serialized draft body is at most65536 UTF-8 bytes. These reversible local storage limits do not enlarge server limits or guarantee quota availability. Empty editable text/recipient lists can be saved, but admission validates the actual unmodified request through the canonical client preparation. Known version1 records migrate conservatively without inventing an admission handle; legacy uncertainty remains held. Unknown/corrupt versions fail visibly.

## Commit before send

One IndexedDB readwrite transaction checks the epoch, reads and changes the scoped record. Individual request success is not sufficient: promises resolve only after transaction completion. Strict durability is requested; unavailable storage/transactions fail closed. This is browser-managed persistence, not an fsync or power-loss guarantee.

Admission freezes operation, canonical bytes and one key separately from the editable draft. A subsequent transaction changes `prepared` to `uncertain` **before** transport handoff. Only one competing tab can win that transition. A crash between marker and fetch is conservatively uncertain. Later edits do not change the original intent. Discard removes editable text, never claims an unresolved write was cancelled. A deliberate `reviewPrepared` can abandon only an intent that atomically remains never-dispatched; it loses a race to any dispatch claim. Confirmed/rejected intents require deliberate acknowledgement before a new identity.

A local dispatch failure or invalid response can leave uncertainty. A success whose durable receipt write fails also remains unresolved. Do not create another key because storage or response handling failed. The shared settings-write classifier is reused without changing settings behavior; durable composition has its own storage transition owner, not a second network/retry implementation.

## Reload, logout and truthful limits

Opening a restored uncertain intent shows `reconciliation-required` and sends nothing. Browser wall time does not prove a24-hour replay window survived suspension/reload, and the current API has no exact idempotency-key lookup proving absence. Similar titles, bounded event pages or a missing row on one read are not reconciliation evidence. There is no force-success/force-absent callback or automatic retry/new-key method. An explicit retained-admission check, described below, can recover an exact retained positive outcome without executing the command. Uncertain legacy intents without a prepared handle remain held even if a matching-key outcome exists: legal key reuse prevents attributing that row to the original attempt. Newly prepared intents can use the exact event evidence below; no missing evidence proves nonexecution.

Scope changes fence every asynchronous read/revalidation/result before UI publication. Logout clears the bound scoped record and increments its durable epoch, including a bounded corrupt-record erase path. Stale bound writes cannot recreate the erased content; other principals' records are untouched. Logout can destroy local unresolved recovery data as required by the original privacy contract; it cannot cancel a write already accepted by the server. App session integration owns the verified human scope before any composer opens. Logout after reload must erase that scope even when the form was never instantiated, and logout from an unopened tab must notify open sibling tabs. Temporary storage connections are closed after scoped erasure. Any storage-clear failure remains visible and blocks composition rather than claiming all local data erased. A caller that deliberately rebinds must first verify the new current session.

## Evidence ownership

Node tests use a clearly labeled memory transaction oracle for storage/controller fault sequences; it is not browser IndexedDB proof. Separate `compose-storage.spec.ts` tests use the existing browser harness with a synthetic same-origin page and actual bundled IndexedDB code: competing connections, actual page reload, actual two-tab claim, cross-principal logout fencing and abort rollback. They do not prove live login, product form behavior, server entity deduplication or deployed acceptance. Exact local/CI outcomes belong in the issue/PR receipt; authored tests are not passed tests.

Primary implementation reference: [IndexedDB transaction lifecycle and scheduling](https://www.w3.org/TR/IndexedDB-3/) (working draft). Existing [delivery semantics](../delivery-semantics.md), [UI write intent](../../src/ui/write-intent.ts) and server idempotency remain authoritative for their separate boundaries.

## Explicit retained-admission recovery

`HubClient.reconcileCreation` accepts only the original createMessage/createTask operation, frozen canonical body and original key. It uses the existing cookie/CSRF transport and fixed generated browser-only reconciliation operation. Neither route is available to native credentials. The UI's **Check original admission** action never resends creation, changes the key or treats a lookup miss as nonexecution.

The response distinguishes retained matching-key evidence, exact prepared admission evidence and unknown. Only exact prepared evidence can settle a previously uncertain intent. Errors, malformed responses and unknown results do not classify the original write as rejected. Current session/workspace/authority is revalidated; asynchronous observations are fenced. The exact scope epoch, operation, key, body and original draft revision must still match at receipt settlement. Identical concurrent confirmations are benign; changed or acknowledged intent cannot be overwritten, and separately edited draft text is preserved. Only minimal entity identity and the prepared admission identity/expiry are persisted; complete responses and request trace IDs are not added to IndexedDB.

A legacy already-confirmed message can offer its validated returned thread for a current authorized read only when the returned entity ID matches its durably known identity. A prepared intent accepts only the exact admission receipt, never a legacy DTO fallback; it offers no invented thread. The UI never guesses a thread ID. A retained task receipt is historical admission, not a current board snapshot; it must not overwrite newer task observations.

The server checks current original command/replay access and exact original-path fingerprint before returning retained evidence. A matching retained row remains positive evidence after the minimum retention period only while it still exists and current checks pass. Missing/GC rows stay unknown, without extending retention or proving absence. Source and browser acceptance receipts are recorded separately; this contract does not establish deployed acceptance or full issue53 completion.

## Exact prepared admission after outcome collection

Before dispatch, `HubClient.prepareCreation` calls the browser-only `messages:prepare` or `tasks:prepare` route with the original body/key. Current cookie session, exact Origin, CSRF, creation permission and reference visibility are independently checked. The opaque `event_` identity is a reference, **not a bearer credential or permission**. No entity, event, outbox or domain outcome is created by preparation. The browser persists the handle by exact scoped CAS before marking dispatch; preparation-response loss cannot have created the domain entity.

A live pending reservation binds workspace, principal, operation, target, key hash and original fingerprint. Exact pending retries preserve both identity and expiry; changed bodies conflict. Its fixed admission window is the existing `OUTCOME_RETENTION_MS` (86400000ms), not a new operator TTL. Technical cost ceilings are64 pending rows per principal,1024 per workspace and200 expired cleanup rows per preparation. Capacity errors never prove prior nonexecution.

Creation with `X-Creation-Admission` rechecks all current authority and requires the exact live reservation. At `now >= expires_at`, or with no reservation, it cannot execute. The entity, reserved event, private versioned intent-binding digest, outcome and exactly one reservation deletion commit atomically. A cached outcome can replay only if its event ID matches the supplied handle; a legacy/native same-key result cannot be relabeled. Missing outcome plus consumed/missing reservation never falls through to creation. Header-absent native/legacy behavior is unchanged, and native requests cannot supply the reservation header.

Explicit reconciliation with that handle requires current `events:read`, original creation/reference guards and current resource visibility. Exact event identity and private binding yield `{status:"admitted",admission:{event_id,entity_id}}`; this is original admission evidence, not a Task/Message snapshot or execution completion. It cannot overwrite current board state or fabricate a thread link. Later same-key admissions have different event identities and cannot confirm this one. Missing, deleted, mismatched or legacy evidence remains unknown. Import-created task events cannot qualify. Public Event DTOs never expose the private binding.

Previously dispatched uncertainty stays held on subsequent errors, including409 or expired/missing-handle responses: those only deny the current attempt, not prove the original never committed. There is no automatic reprepare, new-key replacement or fallback to legacy creation. Event/outcome retention is unchanged; this protocol does not guarantee recovery after event evidence disappears.

Schema17 adds pending reservations and nullable private event binding. Restore must invalidate every pending reservation, including a snapshot taken before later consumption; it cannot resurrect execution authority. Exact schema16 source bytes remain authenticated with their original definitions when restored into17, whose added legacy bindings are NULL and reservation table empty. See [backup/restore](../backup-restore.md) for versioned compatibility and control gates.

### Pattern comparison

[Stripe](https://docs.stripe.com/api/idempotent_requests) explicitly treats reused pruned keys as new requests; an old key alone is insufficient original-instance evidence. [AIP155](https://google.aip.dev/155) distinguishes bounded request-ID deduplication and current-resource responses. [S3 multipart upload IDs](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateMultipartUpload.html) and [tus creation/expiration](https://tus.io/protocols/resumable-upload) motivate a separately prepared operation handle with ordinary authorization. Their lifecycle/replacement rules are not copied: this protocol never replaces uncertain work automatically. Database consumption avoids new signing-key management and permanent anti-reuse tombstones.
