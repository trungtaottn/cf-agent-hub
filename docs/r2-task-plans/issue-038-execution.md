# Issue38 — typed native client facade, local execution evidence

Status: local source implementation and verification complete; evidence packaged separately. Formal capability acceptance stays pending, with integrated acceptance deferred until afterR4. No deployment, distribution or current recovery activation is claimed.

## Baseline and actual workflow

Read live issue38 and corrected pinned plan `20dc6ad91ffd85b7cc1f273df07d16efa35965a5` before code. Exact local predecessor37 is `5dbfd4904b0da4849e50b4282af5b535c46d97b0`, tree `d6146bbe43d1726b3d0d4b0253c79db5d29f2fae`. The isolated no-hardlink clone has no remotes. No remote writes, CH, deployment or merge were performed by this worker; the publication owner controls stacked drafts.

Used the actual installed AgentKit ak-vibe1.4.1 workflow, ak-plan2.2.2, ak-cook2.5.1 TDD/auto route, ak-research1.1.3, ak-debug4.2.0, ak-code-review2.0.3 and journal1.3.1: router/status execution, primary GitHub comparison, validated plan and independent red-team, meaningful failing assertions, implementation, independent security/contract/simplification review, docs and local journal. Installed hooks/configuration are not evidence that hooks executed. No invented ak-vibecode CLI alias is claimed.

## Reconciled implementation

- Issue23's planned generated enabled-operation seam was absent. The owner approved a narrow prerequisite: one reviewed support inventory classifies all61 canonical operations; the existing generator derives54 workspace facade mappings,33 native-lane operations and8 runtime-proof operations from owning OpenAPI. Five disabled R3 operations, auth callback and public liveness are excluded. Source-supported is not deployed/runtime availability: current authorization, maintenance, feature/profile and trusted artifact bindings still govern server responses. Historical x-r1-available flags and formal capability statuses are unchanged.
- The existing14-operation browser HubClient keeps its public constructor/request/CSRF/cookie behavior and shares one fetch/error/JSON parser with the native facade. No second fetch stack, dependency, wire DTO family or broad auth lane. Native accepts exact canonical HTTPS origin, workspace, explicit provider and injected fetch only; unknown/human/R3 operations, malformed wrappers and non-encodable paths/headers fail before credential acquisition. Native full success envelopes use generated validators, canonical status/request-ID/page rules and bounded JSON.
- A trusted provider acquires an atomic slot/generation lease and synchronously dispatches exactly once through a credential callback. Current checks occur after awaits. Private transport-minted receipts bind provider identity, origin/workspace/principal/slot/generation; labels, nominal TypeScript types, JSON copies and another provider's receipt are not runtime authority. Only exact native reads may operate unbound; ordinary mutations need an active receipt. Caller-owned keys and optional expected-binding comparisons never imply hidden retry/rekey/rebind.
- Explicit `enrollRuntime` uses canonical createRuntime through that same transport/lease, requires protected proof capture, and returns only safe `ApiResult<Runtime>` after timely successful capture. Wire `RuntimeIssue.revealed` retains server meaning. Generic createRuntime is enrollment-only and returns local ENROLLMENT_REQUIRED with zero acquire/fetch. Replay-null, failed/late capture and rotation cannot activate a receipt or claim enrollment success. CLI redacted presentation remains issue41; durable credential/proof import/restore and journal integrity are not authenticated by this in-memory witness.
- Finite total deadline covers acquisition, fetch, JSON, capture and streaming. Absolute monotonic expiry complements the timer; zero-progress chunks reject. Already-created promises are rejection-observed even if synchronous work exhausted the deadline, late leases/responses are cleaned up, and secret-bearing exceptions become fixed safe codes. Timeout/abort/credential/capture errors may occur after dispatch; no error code alone proves no-send or permits dropping an unknown-outcome journal entry.
- Artifact upload/download uses explicit expected metadata, safe-integer canonical10MiB size bounds, counted actual bytes and clean EOF, no whole-object collection. Binary success has nullable request correlation because the existing server emits no JSON/request-ID/digest header. Media headers use the server's safe-type fallback and Headers whitespace normalization. Consumers must await completion and destination-write success; client digest or filesystem persistence is not promised.
- Actual Workers Request rejects redirect:error; native uses manual and rejects all3xx/opaque/redirected/wrong-origin responses without another fetch. Browser retains its original error mode. Root and independent security review accepted this runtime-supported no-forwarding reconciliation.

## Meaningful failures and measured comparison

The [primary-source comparison and Workers study](../research/r2-native-client-runtime.md) compare existing small shared transport plus generated wrappers against openapi-fetch, OpenAI JS and Azure pipelines. Real Workers1/8MiB stream fixtures show0 pre-consumption production,32KiB maximum producer-ahead work and32KiB emitted chunks; eager arrayBuffer materializes1/8MiB. The implementation emits at most64KiB slices and retains at most one producer chunk. This does not establish constant heap independent of producer allocation, throughput or deployment capacity. A separate actual Workers/SQLite/R2 test completes1MiB stage/upload/commit/download and verifies bytes using existing server-runtime digest support.

Retained RED receipts include shared non-JSON success acceptance, missing generated seam, initial bounded streams, cross-provider receipt graft, arbitrary ClientFault secret reflection, late-response cleanup, zero-progress producer starvation, non-string operation coercion, strict preflight encoding/undefined unknown keys, expired-before-wait rejected capture/reader promises and normalized media-type comparison. The latter subprocess observed2 unhandled rejections before repair and0 after. Failures and diagnostic compile/test-fixture mistakes remain in logs; no timeouts/assertions were weakened. Real Workers initially exposed unsupported redirect mode; a later test used a noncanonical state expectation, corrected to canonical doing without changing production state rules.

## Verification record

First serial full suites passed Node955/955 and Workers1351/1351 before later independent edge repairs. Focused repair receipts include100/100 and20/20. Final exact production bytes pass Workers1351/1351; after the last TypeScript-only negative-test cast, final Node963/963 and all five TypeScript projects pass. The intermediate tsc exit2 is retained; the correction changes neither emitted runtime behavior nor assertions. Full suites ran serially, and older passing receipts are not substituted for the final source.

| Final gate | Observed result |
| --- | --- |
| Full Workers / Node | 1,351/1,351 across103 files;963/963 across38 files; exit0 |
| Operator / deployment verifier | 18/18 and13/13; exit0 |
| TypeScript / generated / bindings / R1 | All5 projects and all checks pass; exit0 |
| UI build / local runtime boot | Pass; schema15 and empty authority closed |
| Docs / plan structure | 131 Markdown +170 JSON;636 plan checks; pass |
| Native real Workers | 5/5: actual domain/SQLite/R2 flows and1/8MiB stream measurements |
| Independent review | Exact18source/test plus7docs; contract/security approval and independent boundary probes |
| Recovery CLI | 8 pass/18 fail; unchanged protected default temporary-directory guard |
| Browser | 34 collected;1 launch failure/33 not run;0 assertions; exact Chromium1248 absent |
| Fresh dependency audit | Inherited policy-blocked; not attempted, no current result, no retry |

The actual AgentKit plan and CLI-created journal validate; the byte-identical journal is retained outside the source checkout. AgentWiki publish skipped. Exact commit/tree/patch/hash, protected-file checks and independent coverage are bound in the local manifest/handoff, not inferred from a successful aggregate npm check.

Independent reviews cover exact source hashes, generator/handler parity, safe enrollment distinction, genuine receipt authenticity and stream/cancellation limits. Generated AJV is reviewed through owning schemas/generator/export mapping and deterministic reproduction, not an invented manual audit of every generated branch. Reviewer-run probes are distinct from inspected implementer-run suite logs. No aggregate-green assertion is made.

## Immutable and environmental boundaries

Node24.22.1/npm11.19.1; independently hash/inode/symlink-verified copied dependencies, task-local XDG, metrics off. Full suites run serially; only Workers SQL uses task-owned TMPDIR. Package/lock, migrations1–15, frozen V1/schema8 and the protected registry remain unchanged; no schema16 or server-route change. Default/dev artifact ingress stays unbound. Recovery remains closed pending39/43; R3 approvals remain disabled and submit→Review/independent accept→Done unchanged.

Recovery CLI retains default protected `/tmp/.git` guard and must not relocate its fixtures. Browser tests must use the configured exact Chromium1248; collection is not browser assertions. The fresh npm audit gate remains policy-blocked because registry submission transmits dependency metadata. No retry, alternate endpoint or workaround was attempted for issue38. Issue36's [own audit result](issue-036-execution.md) is historical at that snapshot, not a fresh issue38 clean audit. These limitations remain separate from available source checks and deferred integrated acceptance.
