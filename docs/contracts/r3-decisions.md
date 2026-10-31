# R3 closed decision contract

Status: partial source contract; installed actions, runtime integration and acceptance pending; no released artifact.

This [issue 52](https://github.com/trungtaottn/cf-agent-hub/issues/52) slice consumes [the reviewed source bridge](r3-handoff.md). It does not activate request-decision, approval routes, claims or a deployment policy. The source action registry is empty. The [standalone schema](../../spec/decision-policy.schema.json) and generated types describe configuration, not permission. Supplying a schema-valid action name, an example or a profile cannot install an action.

## Explicit policy, no product defaults

A policy requires a positive safe-integer revision, positive finite expiry seconds, bounded expiry batch and closed action entries. Each entry names an exact action/schema version/digest, nonempty reviewer IDs and explicit resource kinds. Duplicate action IDs, duplicate reviewers/resource kinds, extra properties and missing bounds fail. Structural validation does not establish that reviewers are humans, currently assigned, permitted to decide, or able to read every input; transaction-current resolution must prove those facts. The acting human needs their own current assignment/access, not another human's eligibility and not invented unanimity.

Local contract ceilings are 64 action entries,64 reviewers/resource kinds per entry,128-character identity fields,65536 serialized UTF-8 policy bytes and 200 expiry units per bounded call. These are explicit finite work limits, not measured deployment capacity. Actual expiry values, human assignments and action semantics remain operator-owned; no universal TTL is selected. The [valid example](../../examples/decisions/policy-valid.json) uses synthetic arithmetic values with an empty action list, not recommended defaults. The [invalid test fixture](../../test/fixtures/decisions/policy-invalid.json) demonstrates missing expiry, zero batch and forbidden unlimited mode.

`parseDecisionPolicy` returns detached structural data only. `resolveConfiguredAction` remains unavailable for every action because no product action schemas have been approved and installed. The existing deployment schema does not accept this new policy member. Later activation requires a separately reviewed source registry, exact schema semantics and trusted deployment installation; arbitrary schema URLs, modules or proposal-supplied callbacks are not such a registry.

## Exact input bytes

The canonical Proposal.inputs remains artifact ID plus lowercase SHA-256; no public verified flag or new DTO authority is added. Input MIME must be exactly `application/json`. `inspectProposalBytes` snapshots at most 10485760 bytes before asynchronous hashing, parses that same snapshot and returns its actual SHA-256/byte length and frozen JSON content. Formatting changes change the identity. This output is **not** VerifiedProposalInput: it proves neither committed artifact generation, workspace/access/retention, schema match nor policy provenance. Issue 54 must retrieve bounded immutable bytes and bind current manifest/generation, exact content and trusted policy outside/inside the transaction correctly.

`parseExactJson` rejects invalid UTF-8, a leading BOM, duplicate decoded object member names at every depth (including escaped aliases), invalid grammar and unpaired surrogate escapes. Unicode normalization is not performed. JSON numbers are deliberately narrowed to mathematically exact safe integers; decimal quantities must be explicitly schema-defined strings. Exponent notation representing an exact safe integer is allowed, but underflow/rounding cannot turn a fraction into permission. These numeric/Unicode restrictions are this proposal contract, not claims that RFC 8259 forbids all such JSON.

Required parser budgets can only narrow the hard 10485760-byte/64-container-depth/100000-value limits. Root containers count as depth 1; every value including containers counts as a node, object member names do not. An iterative duplicate/resource preflight precedes native grammar parsing. No dependency or remote reference is fetched. Hashes use original bytes, never reserialized parsed data.

## Association accounting amendment

For this new decision contract, retain each existing per-role limit: at most 5 checkpoint artifacts and 5 proposal artifacts, at most 8192 bytes of serialized ID references per list, no duplicate ID within a list, and at most 10485760 bytes per artifact. The input artifact is a separate role edge. Across all three roles the **distinct-ID union is capped at 5 artifacts and 26214400 retained bytes**. Repeated IDs across roles count once only when generation/hash/size agree; every role edge still exists and needs current authorization. This is an explicit new aggregate restriction, not a claim the historical per-list schema already imposed it.

`accountDecisionArtifacts` models finite count/byte consistency. It does not prove actual bytes, commit status, actor/read rights or retention. Later transaction owners must retain/recheck every referenced generation and reject revoked, replaced, missing or contradictory commitments atomically. No retention deletion policy changes here.

## Owner-selected bounded reuse — 2026-10-31

The owner approved reuse only within the original unexpired approval lifetime, with unchanged current policy and exact approved intent/target bindings, and affirmative proof the prior attempt produced no effect. Every fresh attempt receives a fresh run/fence and consumes the ordinary retry budget. Unknown or possibly effected work is held for reconciliation, not automatically resent. Reuse never renews approval; expired authority requires a new approval.

The existing R2 captured replay-safe rule fields and runtime `outcome_unknown=false` do **not** establish no effect. An externally idempotent operation may already have effects. Missing receipts, timeouts, lease expiry or a later refusal cannot erase earlier uncertainty. Trusted evidence must cover every authorization-significant effect of every earlier attempt under that approval, not just the most recent operation.

Immutable authority includes workspace/task/approval, proposal and approval versions, action/schema identity, input artifact generation/hash, policy identity/epoch and exact target-resource versions. Evolving task/run versions are different: each command still supplies the exact current expected version, while permitted claim/failure transitions advance lifecycle versions. The pure model starts at the approved task version and preserves retry count already consumed before approval; it never resets the task budget to satisfy a fixture. Arbitrary metadata/target drift is not an allowed lifecycle increment.

`reuseDenials` is a **pure diagnostic model**, not an authorizer. Even an empty result does not authenticate observations or prove live no-effect provenance/current grants. Synthetic positive fixtures are not trusted producer evidence. No runtime consumer or public observation-to-authority minting function exists. Later source-owned producer/transaction adapters must establish the evidence and lineage; unsupported histories fail closed rather than being recaptured under old approval.

## Version and expiry obligations for later persistence

| Event | State/version contract |
| --- | --- |
| Request decision | Current owned run/fence and exact current task version; end run paused, Doing→Waiting, increment task/new proposal once, create approval version 1; no new run |
| Approve | Current assigned human/session/CSRF, all current expected task/proposal/approval versions and now before expiry; pending→approved, Waiting→Ready; changed task/approval increment once, proposal unchanged |
| Reject | Same current human/version checks; pending→rejected, Waiting→Backlog; changed task/approval increment once; no automatic retry |
| Pending expiry | At now≥expires_at mark expired and retain Waiting with actionable state; increment changed observable task/approval once; no renewal |
| Approved but not dispatched expiry | Proposed explicit extension: remove claim eligibility and return Ready→Waiting with expired approval; retain history. Persistence/flag integration requires review before activation |
| Claim / known-no-effect failure | Fresh run/fence and ordinary task lifecycle version increments; original approval/proposal/expiry unchanged; reuse also needs genuine no-effect evidence, current bindings and remaining retry budget |
| Expiry after dispatch | Prevent new authorization/reuse but retain actual in-flight/outcome evidence; never infer cancellation or no effect. Settlement under expired approval requires explicit runtime integration |
| Cancel / permitted requeue | Invalidate approval authority and preserve history; current authorization/state/version checks remain; cannot clear uncertainty or renew approval |
| Replay / repeated sweep / terminal no-op | No repeated state increment, event, retry charge or new run; current access precedes replay |

This table is a reviewed contract target, not implemented SQL, alarms or race evidence. An expired Waiting task has explicit authorized cancel/replacement recovery; no silent renewal endpoint. Native requests still require bearer/runtime proof and current lease/fence; human decisions still require verified session/CSRF/current assignment. None of these helpers bypasses those existing closed routes or completes a task.

## Verification and remaining gate

Focused tests cover structural policy failures, exact parser boundaries, actual-byte hash difference, MIME, immutable binding differences, deadline/no-effect/lineage/budget diagnostics and union accounting. They use synthetic observations, not an installed action or provider effect. Exact execution receipts belong in the PR/issue handoff. Runtime producer provenance, actual artifact access/generation races, decision persistence/expiry, competing claims and independent live acceptance remain later work. Issue 52 is not fully closed merely because this partial contract is green.

Primary references: [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259), [ECMAScript JSON.parse](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse), [JSON Schema 2020-12 validation](https://json-schema.org/draft/2020-12/json-schema-validation). JSON.parse discards duplicate member history; schema validation of parsed values cannot reconstruct it.
