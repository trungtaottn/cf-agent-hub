# R2 local isolation evidence design and fixture study

Status: local source study; formal capability acceptance pending. Not a deployment benchmark or security signoff.

## Design comparison

A static OpenAPI flag check can prove inventory correspondence but not current authority, runtime availability or effects. Generic invalid requests can fail schema validation before reaching a protected operation. A broad status-only matrix can therefore look complete while exercising no admitted mutation.

The selected design combines an independent54-operation/lane list with valid per-operation recipes, actual Workers ingress and two mapped SQLite Durable Objects. It checks canonical DTO/content, durable mutation families, exact no-effect snapshots for clean denials, real native facade calls and an executed-phase receipt ledger. Conditional artifact bindings are absent or aliased to the recovery bucket; no fake availability switch is introduced. Unavailable R3 operations and forbidden human/native lanes are denied, not skipped. Focused inherited domain suites retain deeper graph/lease/replay rules rather than being rewritten as weaker umbrella tests.

Primary implementation references researched before unfamiliar test APIs:
- [Cloudflare Durable Object testing example](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/examples/testing-with-durable-objects.mdx): same-isolate object inspection and real storage test boundaries.
- [Vitest consistent-each-for reference](https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/docs/rules/consistent-each-for.md): table-driven case registration; registration alone is not a passing receipt.

Installed Cloudflare test-helper types and implementation were inspected for exact local APIs. No dependency was added or installed, no public npm audit was retried, and no test contacted a live deployment.

## Measured fixture teardown

A retained three-case local Workers experiment measured whole-test durations of55ms for installed-only setup,86ms for native-only setup, and5,101ms for signed-human setup. The latter retains JOSE's bounded5s remote-JWKS abort timer after successful login. Response bodies were consumed; existing `identity-http` and `settlement-ingress` tests document the same condition.

The selected correction uses their established initial-eviction `beforeAll` pattern to drain setup I/O before the default-timeout authority/restart assertions. No assertion timeout, authentication check, recovery guard, browser pin or environment marker was relaxed; no sleep or proof renewal was introduced. The measured test duration includes setup and teardown and is not an isolated service latency, throughput, CPU/heap measurement or SLO. `evictDurableObject` is graceful teardown with persisted SQL, not a process crash or proof that uncertain external effects completed.

## Production finding and evidence limits

Three real wrapper tests first failed because a second scheduler repair awaited after protected projection. A synthetic physical-alarm failure leaves real dirty SQL; the next physical repair is held while the original credential/session or maintenance generation changes. The narrow owner-authorized fix removes only that final await. Startup, writer background repair and durable debt remain; failed-arm restart/retry and unchanged R1/outbox suites verify their own semantics.

The independent security review turn was flagged and no final signoff exists. It was not retried, rephrased or routed around. Ordinary contract review and implementer-run regression evidence are explicitly different from independent security approval. See the [execution record](../r2-task-plans/issue-040-execution.md) for actual final counts and non-passes; integrated live acceptance remains after R4.
