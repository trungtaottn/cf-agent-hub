# Consumed decision local journey observations

Status: Eight fixed local source journeys tested; release and deployed acceptance remain pending. No released or formal R3 acceptance is established.

The private Workers producer exercises eight fixed command-source journeys:

- `fresh_runtime_native_review_done`: native requester A requests a decision; synthetic human H reads the current approval and exact committed input bytes, approves, and A enrolls a new runtime. An approved claim consumes one new run/fence, submits a result, and distinct native B reads the current result and artifact bytes before accepting. Self-review, wrong proof and duplicate effects are checked.
- `approved_cancel_before_claim`: an actual cancellation prevents the approved claim, retaining decision history without consumption.
- `approved_credential_revoke_before_claim`: actual credential revocation prevents claim and request replay without rewriting the approved decision.
- `consumed_failure_held`: failure retains the consumed pair and `outcome_unknown`, with no retry authorization.
- `consumed_lease_expiry_held`: an actual bounded lease sweep retains that uncertainty and consumed pair; repeated sweep and stale mutations cannot create another transition.

- `consumed_active_restore_resume_held`: local capture and restore retain the consumed pair. Real local retirement, probe and resume open the target before current native identity and old runtime/session denials are checked. The restored active task becomes Backlog with `outcome_unknown`; its original Doing head and completed authenticated restore-expiry audit remain distinct from ordinary lease expiry.
- `done_history_restore_resume`: completed review history and exact artifact bytes survive the same local control sequence; current native B reads restored bytes and acceptance replay creates no additional effect.
- `two_workspace_decision_claim_denial`: independently configured workspaces and actual command-created resources exercise six exact cross-workspace denials with complete no-write comparisons.

Earlier request/human and maintenance-only recovery coverage is described in [local journey observations](r3-local-journey-observations.md). It is separate from these post-resume cases. All control authority and identities here are local synthetic fixtures, not live operational evidence.

## Evidence boundary

`test/helpers/r3-consumed-journey-fixture.ts` drives the existing domain commands using a fixed signed local fixture. Its separate closed observation format is owned by `test/helpers/r3-consumed-journey-observation.ts`:

- `format_version: 1`
- `stage: consumed-command-source-fixture`
- `origin: local-workers-synthetic-fixture`
- `acceptance_eligible: false`

Configured A/B/H identities and actually observed event actors are separate. B acceptance is observed only in the completed review cases, never inferred from a configured grant. H is a synthetic session, not evidence of a real independent human or identity provider.

The producer checks bounded complete private state for no-write attempts, records exact table/event/outcome effects, and measures committed object streams. Safe observations contain identity, version, chronology, digest and relation facts—not credentials, runtime proofs or raw private payloads. Direct source queries have no HTTP status or request/idempotency identity. Downloads record their actual response status; domain commands record their canonical outcome. Lease sweeps have no request/idempotency identity or command outcome.

Bounds are fixture limits, not product capacity: 160 idempotency outcome rows and 128 rows for each other table, 64 KiB per row, 2 MiB total private snapshot, 64 KiB per measured object, and 256 KiB per encoded safe observation. Overflow fails rather than truncating.

Capture and restore observations correlate multiple actual source operations to their stored outcomes; they are explicitly aggregate diagnostics, not one atomic command. A missing-probe attempt records its actual pending admission and resumes the same operation after probing. Plain source exceptions carry no invented HTTP status. Completed public restore audit provenance is required; staged import provenance cannot satisfy a resumed observation.

The production action registry remains empty. These source observations do not activate an action, authenticate a producer/build/controller, prove installed MCP behavior or deployed recovery, or close issues #65, #66 or formal #67. Content hashes establish integrity and local consistency only.
