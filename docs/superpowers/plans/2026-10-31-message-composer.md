# Complete Message Composer Implementation Plan

Status: reviewed source design; exact-head browser acceptance pending; no released artifact.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issue 55 with authorized references, replies and committed R2 attachments.

**Architecture:** Keep shared durable SubmitController as sole admission state owner. Add an ephemeral attachment state owner and a closed cookie-only client lane; the server remains authoritative.

**Tech Stack:** TypeScript, DOM, IndexedDB, existing HubClient, Workers/R2, Vitest and Playwright.

**Spec:** [Reviewed design](2026-10-31-message-composer-design.md).

## Global Constraints

No new endpoint, grant, credential, retention or dependency. Body 32768 / envelope 65536 / refs 8192 UTF-8 bytes; binary file 10485760 / five distinct artifacts / aggregate 26214400 bytes. Persist committed IDs only, never raw file content or credentials. No commit/publication by implementation workers.

## Review Focus

- Stage-response loss after outcome GC stays unknown, never re-stages as recovery.
- Optional denied reads clear CSRF; fresh authority is checked last.
- A readable thread does not prove caller membership; server denial preserves draft.
- Every async completion checks owner generation before exposing private state.
- Historical admission receipt must not fabricate current DTO/history.

## Tasks

### 1. Closed browser artifact lane
Files: packages/client/src/client.ts, types.ts, test/client/browser-artifacts.test.ts (disjoint worker).
- [ ] RED: cookie-only stage/upload/commit, exact Blob size, forbidden fields, fresh CSRF and revocation.
- [ ] Implement BrowserArtifactRequest and HubClient.artifact with generated validation, no retries.
- [ ] Run focused client tests and typecheck; independent review.

### 2. Message model and references
Files: src/ui/compose/message-form.ts; test/ui/message-form.test.ts.
- [ ] RED: final-authority ordering, historical lookup, immediate scope privacy, refs/committed IDs/reply subset.
- [ ] Implement addReference(kind,id), attachArtifact(id), loadReferenceThread(threadId), selectThread(threadId), startNewThread(), canonical payload retention.
- [ ] Run `npx vitest run test/ui/message-form.test.ts`; all pass including existing loss/privacy tests.

### 3. Ephemeral attachment state
Files: new src/ui/compose/message-attachments.ts; test/ui/message-attachments.test.ts; runtime suite registration.
- [ ] RED: exact limits/+1, stage loss held, upload/commit read-first checks, frozen keys, scope disposal, no raw persistence.
- [ ] Implement add(file), check(localId), retry(localId), remove(localId), dispose(); immutable public status snapshots contain no Blob.
- [ ] Run focused Node suites; inspect serialized draft keys and callbacks.

### 4. Production UI integration and capability
Files: message-form-view.ts, app.ts, workspace-routes.ts display intersection, focused health tests.
- [ ] RED: refs/reply/upload controls, keyboard/error focus, artifacts:write actual display vs revoked/ungranted denial.
- [ ] Wire real current client operations and fresh upload authority; no server permission changes.
- [ ] Run model/DOM tests, health Workers, full typecheck/build/generated/docs.

### 5. Actual browser acceptance and review
Files: compose-message.spec.ts and composition fixture/probe as required.
- [ ] Add actual session/CSRF/R2/SQL scenarios for file commit/new message/reply/denial/loss/keyboard/privacy.
- [ ] Run bundle/list locally only; parent supported CI runs actual browser.
- [ ] Run full Node and affected Workers, preserve every failure, independent review and exact source handoff.
