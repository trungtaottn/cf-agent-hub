# Local native/MCP parity evidence

Status: Local synthetic source-test evidence; parent integration and deployed acceptance pending; no released capability claim.

The [fixed parity suite](../../test/mcp/native-worker-parity.test.ts) exercises the built STDIO adapter with the installed pinned MCP SDK, a real protected credential/runtime provider and journal, trusted local TLS, and the actual Worker/SQLite Durable Object. The proxy changes only the configured origin; it does not replace native domain responses. Each case records actual Worker/adapter build hashes, SDK package/entry identity and elapsed time.

## Fixed coverage

- Sixteen core tool cases each compare allowed and denied native/SDK outcomes: four workspace/agent/task reads; six task/run operations; six message/artifact/search operations.
- Three pure tests verify that complete JSON semantic comparison permits property ordering but rejects changed nested artifact or generated run identities.
- Three shared integration groups cover retained native cursors and bindings, current run/fence/proof and credential authority, and a claim response lost only after the real Worker committed and produced its response.

Successful mutations originate through SDK/MCP. The comparator uses the original semantic body and idempotency key through the existing native client; the retained canonical result must match and the replay must add no durable effects. Reads are labeled read-repeat, not historical mutation replay. Per-attempt correlation is checked separately; no DTO fields, IDs, versions, fences or timestamps are discarded. This is not a substitute for the separately reviewed MCP historical-result lookup contract.

The fixture checks every registered SQL table with complete bounded snapshots before materialization and hashing. It requires exact operation-specific inserts/updates, event/history/state joins, and zero unlisted effects. Artifact metadata is prepared by actual native stage/upload/commit against local R2; bounded object snapshots retain only key hashes, sizes and content hashes. No private configuration, credentials, runtime proofs, journal payloads or object keys are exported as evidence.

## Recorded local run

The unfiltered suite passed all 22 tests without skips in 95.18 seconds on the PR147 source baseline (local `b9d5d050`, tree `378fce0b`) plus this test-only lane. Root type-checks also passed. The 16 core tests cover 32 allowed/denied operation outcomes; the three shared integration groups and three pure guards are counted separately. Parent integration and CI must rerun the registered suite on their composed revision. No test timeout or CI time budget was increased.

The measured SDK was `@modelcontextprotocol/sdk` 1.32.2. The local run retained these byte identities:

| Built input | SHA-256 |
| --- | --- |
| Fixture Worker | `3baa17d48df4b80bd1cde419483c7f058e990ff1fb25d94f7801440382f4d449` |
| Production STDIO adapter | `6e0c3a5393a4a21828928c9834a174dead108e441042980cfcaafbf483a36532` |
| Installed SDK client entry | `db6cc643f5cc095b2fd0b70bf691d1775f07a317e97555e3928559e815f5e32a` |
| Installed SDK package metadata | `7a8d6f79ee52e2bf7cfe23f2d79f7e3c0ab6a3912a340ec345d6ff014534d59d` |

These hashes identify measured local inputs, not producer authenticity or a deployed binary.

## Limits and controls

Missing-scope cases use otherwise valid local resources and actual runtime enrollment. Three task-execution denials require an explicit test-only downward scope removal **after** a genuine owner claim, because claiming itself requires both claim and execute scopes. These are fault-injected current-authority checks, not a supported grant-management journey. Separate revocation coverage invokes the supported domain command under a synthetic human session; it does not prove live OIDC or independent human admission.

The post-commit loss case preserves the complete validated journal entry privately across process restart and performs observation reads only. It proves one committed claim and no automatic business resend; it does not turn a historical response or a read into renewed execution authority or an external-action no-effect proof.

Production decision descriptors remain empty. The existing tool17 unavailable-action/revocation test is separate negative evidence, not a positive `request_decision` journey. See [MCP client evidence](mcp-client-evidence.md) for the remaining action, deployed environment, advertised-client and formal acceptance boundaries. A passing local suite does not close formal R3 acceptance.

## Two-workspace task-read follow-up

The same required Node suite now includes a bounded task-read isolation case,
using [a separate private fixture](../../test/mcp/workspace-read-parity-fixture.ts)
and [the built-STDIO driver](../../test/mcp/workspace-read-parity-driver.ts).
Two configured workspace IDs resolve to distinct SQLite Durable Objects. Each
workspace receives a task through the actual native create command and its own
synthetic protected-provider state. Native and MCP reads must agree on the own
task and on denial of the other workspace's genuine task ID, in both directions.
Complete bounded snapshots of both stores must remain unchanged after every
read. The separate wrong-workspace tool-argument checks are protocol rejection,
not a substitute for the HTTP/domain foreign-resource comparisons.

This follow-up is authored source, not an executed receipt. Local execution is
blocked in the editing environment by absent root/MCP dependencies and a Node
24.11.0 image rather than the pinned 24.22.1 runtime. The existing package check
and required Node suite must run on the exact new candidate before this case is
reported passing. Existing 22-test observations above remain historical and do
not attest the additional case. This slice does not cover cross-workspace writes,
all resource families, positive decision action admission, or live acceptance.
