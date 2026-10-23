# Toolchain and local verification

CF Agent Hub uses exact project dependencies and a committed npm lockfile. Run `npm ci`, not an unpinned installer. The implementation runtime is Node 24.11.0 with npm 11.6.1; Node 24.19.0/npm 11.9.0 is the separately recorded browser validation host. The engine declaration records the original runtime exactly; a newer Node 24 patch is reported explicitly when validating.

| Component | Locked version |
| --- | --- |
| TypeScript | 6.0.3 |
| Wrangler | 4.152.0 |
| @cloudflare/vitest-plugin | 1.4.7 |
| Vitest | 4.1.12 |
| Vite | 7.3.7 |
| Ajv / ajv-formats | 8.20.0 / 3.0.1 |
| @playwright/test / Playwright | 1.64.1 |
| JOSE | 6.2.13 |
| Node types | 24.10.0 |
| Miniflare (published transitive dependency) | 5.20261019.2-beta |
| workerd | 1.20261019.1 |
| Chromium headless shell | 156.0.8078.4, revision 1248 |

The beta Miniflare version is part of the published Wrangler/plugin dependency graph. No forced overrides or legacy peer resolution are used. `npm ls --all` reports the actual resolved tree.

## Commands

- `npm run generate:config`: deterministically generate validator JavaScript and TypeScript declarations from the canonical deployment/bootstrap JSON Schemas.
- `npm run verify:generated`: reject stale generated output.
- `npm run typecheck`: check Node fixtures and the separate production Worker type scope.
- `npm test`: local Ajv contract and configuration tests.
- `npm run test:workers`: actual workerd SQLite transactions, migrations, catalog identity and installation tests.
- `npm run verify:r1-contract`: standalone contract linkage checks.
- `npm run check`: generated-output drift, both type scopes, contract checks, local tests and Workers tests.
- `npm run test:ui`: separate bundled-browser HTTPS fixture gate. This is never silently included in a passing non-browser gate.
- `npm run verify:release`: calls the release verifier owned by the recovery/release implementation. Until that file exists this command fails. A missing verifier is not a release pass.

Generated validators import static Ajv runtime helpers, with no schema compilation, `eval` or `new Function` in the Worker. `wrangler types` generates `worker-configuration.d.ts` from the locked Wrangler/configuration. Node fixture types are excluded from `tsconfig.worker.json`.

## Durable Object provisioning and transaction boundary

The explicit compatibility date is **2026-10-19**. The fresh Worker uses declarative `exports.WorkspaceDO` with SQLite storage. Do not add legacy `migrations/new_sqlite_classes` declarations. Application SQL migrations are separate: each version and its schema changes commit together inside `storage.transactionSync`. Failed migrations keep admission closed. Do not delete a namespace as a repair technique.

Production, dev and test use different Worker names and therefore different Durable Object namespaces. Their private R2 bucket names also differ. No R2 HTTP route is exposed. All product ingress remains closed while authentication and domain operations are pending; `GET /health/live` reports ingress liveness only.

`reconcileConfiguration` is internal binding RPC. Its context is constructed by the authenticated operator gateway, which owns Access identity and bundle HMAC verification. TypeScript types do not authenticate RPC data. The object revalidates closed shapes, digests, workspace scope, actual object identity, current authority/CAS, monotonic epochs, credential identity/hash and replay rules. No public HTTP input selects this method. Test-only synthetic operator contexts are supplied only through internal bindings and establish storage semantics, not production operator authentication.

`prepareBootstrap` hashes canonical JSON: object keys sort lexicographically, array order is retained. Configuration digest covers the complete config. Installation digest covers `{config,bundle}` with the bundle's `auth` field omitted; the gateway separately authenticates the complete signed bundle material. All cryptography runs before transaction entry. Synchronous transaction callbacks must not return a Promise or perform network/R2 work.

Worker storage isolation is per test file. Ordinary tests use distinct named objects. Restart evidence uses `evictDurableObject` and the same namespace/name, comparing exact rows before/after; harness reset is not durability evidence.

## HTTPS browser fixture

`playwright.config.ts` owns `node scripts/start-ui-test-server.mjs` and graceful teardown. The script runs Wrangler's supported `createTestHarness`, starts ephemeral loopback TLS application/provider listeners and exact-authority CONNECT proxies, installs explicit synthetic grants through a binding, and verifies provider discovery, signed tokens and Worker authority before its stdout readiness marker. There is no competing URL readiness condition.

Configured HTTPS origins are `https://hub.fixture.example.invalid` and `https://issuer.fixture.example.invalid`, without ports. Browser routing admits only those two exact authorities on logical port 443; unknown hosts, alternate ports, direct loopback and ordinary HTTP proxy requests are rejected. Worker outbound requests use a separate exact discovery/token/JWKS URL and method dispatcher. Its Node TLS connection explicitly trusts the temporary provider certificate, verifies issuer hostname/SNI, and never follows redirects.

The provider implements authorization code/query mode, PKCE S256 and confidential `client_secret_basic`; codes are short lived and single use. It uses ephemeral RSA keys and signed RS256 ID tokens. These helpers never enter the deployed source graph.

The disposable bundled default Chromium headless shell receives only the fresh application/provider leaf SHA-256 SPKI values in `--ignore-certificate-errors-spki-list`. This is a key-scoped process-wide certificate-error exception. It is not general CA/hostname trust or universal pin enforcement: an ordinarily valid unpinned certificate can still pass the normal verifier. Exact CONNECT routing is mandatory. No blanket certificate exception, shared browser profile or system trust changes are used. A separate proxy presents a fresh invalid unpinned key at an otherwise allowed authority for the negative browser gate.

Install the project browser with `./node_modules/.bin/playwright install --only-shell chromium` on a host with supported browser libraries. Use task-owned `TMPDIR` and `PLAYWRIGHT_BROWSERS_PATH` when the default temporary volume is small. Browser download does not prove host-library availability or successful browser operation. `node scripts/start-ui-test-server.mjs --self-check` verifies the non-browser fixture, installed authority, signed provider and listener teardown; it does not replace the browser tests.

## Primary references

- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/) and [test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/).
- [Wrangler test harness API](https://developers.cloudflare.com/workers/wrangler/api/) and [test-state preparation](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/).
- [Durable Object provisioning](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) and [SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
- [Ajv standalone generation](https://ajv.js.org/standalone.html).
- [Playwright browsers](https://playwright.dev/docs/browsers) and [webServer readiness](https://playwright.dev/docs/test-webserver).
- [OIDC Discovery metadata](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata).
- Exact package metadata is published at the npm registry endpoints for the versions in the table; the committed lockfile records integrity hashes.
