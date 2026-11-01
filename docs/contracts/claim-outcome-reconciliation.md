# Historical claim outcome lookup

Status: Local synthetic source-test evidence; no release, deployment or end-to-end R3 claim.

## Closed operation

`lookupTaskClaimOutcome` is a native-only `POST` to
`/v2/workspaces/{workspace_id}/tasks/{task_id}:claim-outcome`. It accepts the
original closed `TaskClaimRequest` and original idempotency key (1–256 ASCII
characters from `!` through `~`). Current credential, runtime proof, claim/execute
grants, resource visibility, installed epoch and maintenance admission remain
required. Cookies, CSRF, creation-admission headers and query parameters are
rejected. No human-session or CLI-command mapping is added.

The endpoint only reads. It never invokes the command executor, applies a missing
claim, repairs scheduler state, renews a lease or retention, or falls back to
`:claim`. Its fingerprint uses the original claim URL and body. A retained
successful response returns the original `TaskCommandResult` with a **fresh
lookup request ID**. Missing or expired retention returns `404 NOT_FOUND`, which
requires reconciliation, not an inference that the original effect did not
happen. A retained conflicting fingerprint returns `409 IDEMPOTENCY_CONFLICT`.
Older-server refusal never triggers a fallback claim.

## Historical identity is not authority

The final transaction samples server time after asynchronous parsing and
authentication. Retained availability uses the original 24-hour ledger interval.
This is not an identity proof based on a client clock: server and client clocks
are independent.

Identity joins the original expected task version, run/runtime/credential/epoch/
fence, initial start and lease timestamps, accepted claim event and task history.
Approved claims also require their irreversible consumed run/fence pair and
current visibility of returned references. Task transitions increase versions;
outcome cleanup does not delete task/run identity, and restore invalidates
restored runtime authority. The same original expected version cannot produce a
second successful claim after ledger cleanup.

Mutable **current** run status, version or lease need not match the old response.
Historical data may still say `active` after the run has ended. It is not a live
lease, a current fence or permission to execute, renew, submit or reuse work.
Read current state and obey current server authority before another effect.

## Protected MCP behavior

`hub_task_claim` keeps its existing name and schema. An unsent intent has one
final guarded first dispatch. If another coordinator dispatches first, the loser
does not resend or fall back during that call. A previously dispatched claim
uses only the fixed lookup, including after restart when its old write clock is
unusable. Ordinary native write replay rules are unchanged.

The protected provider, current binding, original key/body/stamp and ambiguous
owner-heartbeat stop remain checked. Lookup stores no response DTO and does not
change journal state. Success is a genuine current server response, not a local
cached success. Other settled mutations retain their existing reconciliation
behavior. Journal identity, nonpruning profile and storage caps are unchanged.

The generator aliases the existing claim request validator only after proving
complete canonical wrapper equality. Shared authentication validator bytes and
frozen R2 rosters stay unchanged. The extra native operation adds neither an
eighteenth MCP tool nor a CLI command.

## Local evidence

The focused source tests exercise current authority, bounded reads, retention,
corrupt joins, synthetic consumed-approval lineage, public Worker/DO ingress and
no SQL effects. Protected provider/journal tests cover write-clock refusal,
lookup-only recovery, races and denied responses without fallback.

The genuine local chain uses the pinned SDK, production STDIO subprocess,
protected custody, trusted-CA loopback HTTPS and exported Worker/SQLite DO. It
commits one claim, drops its response, closes the SDK process, performs a real
native failure settlement, then starts a new SDK process. Native and SDK lookup
return the same original domain DTO with genuine fresh correlations; full SQL
and the original journal stamp stay unchanged. Current revocation returns401,
changed local intent does not send, and uncertain heartbeat blocks lookup.

This test-only proxy changes only upstream URL origin, preserving method/path/
query/body and authority headers. It does not certify a deployed hostname or
weaken TLS. Production decision descriptors remain empty. Local source evidence
is not formal R3, product-action or live acceptance.
