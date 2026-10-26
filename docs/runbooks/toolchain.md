# Toolchain and local verification

Status: R1 candidate with pinned local runtime verification; dependency and deployed release acceptance pending.

CF Agent Hub uses exact project dependencies and a committed npm lockfile. Run `npm ci`, not an unpinned installer. The candidate pins Node **24.22.1** and npm **11.19.1**. The official Node distribution archive was checked against its published SHA-256 and its bundled Node/npm versions were executed. The detached release signature was not verified. An earlier scoped check on Node 24.11.0 remains historical evidence; the final candidate gates run again on the pinned runtime.

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

The beta Miniflare version is part of the published Wrangler/plugin dependency graph. The current package manifest declares `undici: ^7.30.1` and `zod: ^4.6.6` overrides. The lockfile owns their resolved versions; overrides do not rewrite copies embedded in distributed bundles. Do not use forced installation or legacy peer resolution to bypass compatibility checks. `npm ls --all` reports the actual resolved tree.

## Commands

- `npm run generate:config`: deterministically generate validator JavaScript and TypeScript declarations from the canonical deployment/bootstrap JSON Schemas.
- `npm run verify:generated`: reject stale generated output.
- `npm run typecheck`: check Node fixtures and the separate production Worker type scope.
- `npm test`: local Ajv contract and configuration tests.
- `npm run test:workers`: actual workerd SQLite transactions, migrations, catalog identity and installation tests.
- `npm run verify:r1-contract`: standalone contract linkage checks.
- `npm run check`: generated-output drift, both type scopes, contract checks, local tests and Workers tests.
- `npm run test:ui`: separate bundled-browser HTTPS fixture gate. This is never silently included in a passing non-browser gate.
- `npm run check:runtime`: boot the actual local Worker, validate liveness JSON/schema 7 and confirm uninstalled authority remains closed.
- `npm run verify:readiness`: bounded protected HTTPS readiness reads; see the deployment runbook for descriptor input.
- `npm run recover:workspace`: the eight finite authenticated logical SQL recovery commands; see the recovery runbook.
- `npm run verify:release`: validate the exact revision, source/build bytes, review, toolchain, feature/route and deployed recovery records. Missing evidence fails closed; synthetic fixtures are verifier tests, not a release receipt.

Generated validators import static Ajv runtime helpers, with no schema compilation, `eval` or `new Function` in the Worker. `wrangler types` generates `worker-configuration.d.ts` from the locked Wrangler/configuration. Node fixture types are excluded from `tsconfig.worker.json`.

## Durable Object provisioning and transaction boundary

The explicit compatibility date is **2026-10-19**. The fresh Worker uses declarative `exports.WorkspaceDO` with SQLite storage. Do not add legacy `migrations/new_sqlite_classes` declarations. Application SQL migrations are separate: each version and its schema changes commit together inside `storage.transactionSync`. Failed migrations keep admission closed. Do not delete a namespace as a repair technique.

Production, dev and test use different Worker names and therefore different Durable Object namespaces. Their private R2 bucket names also differ. No R2 HTTP route is exposed. Product ingress remains closed before explicit authority installation and during maintenance/retirement; `GET /health/live` returns `{"status":"alive"}` and reports ingress liveness only.

`reconcileConfiguration` is internal binding RPC. Its context is constructed by the authenticated operator gateway, which owns Access identity and bundle HMAC verification. TypeScript types do not authenticate RPC data. The object revalidates closed shapes, digests, workspace scope, actual object identity, current authority/CAS, monotonic epochs, credential identity/hash and replay rules. No public HTTP input selects this method. Test-only synthetic operator contexts are supplied only through internal bindings and establish storage semantics, not production operator authentication.

[`prepareBootstrap`](../../src/config/bootstrap.ts) hashes canonical JSON as UTF-8 with SHA-256: object keys sort lexicographically, and array order is retained. The configuration digest covers the complete `config`. The installation digest covers exactly this preimage:

```js
{
  config,
  credentials: [...bundle.credentials].sort(order),
  retired_credentials: [...bundle.retired_credentials].sort(order)
}
```

`order` compares `workspace_id` first, then `credential_id`, ascending with JavaScript string `<`/`>` comparisons. Only these two copied credential arrays are sorted; arrays inside `config` retain their declared order. Other bundle fields, including `auth`, are outside this installation-digest preimage. The gateway separately authenticates the signed bundle. All cryptography runs before transaction entry. Synchronous transaction callbacks must not return a Promise or perform network/R2 work.

Worker storage isolation is per test file. Ordinary tests use distinct named objects. Restart evidence uses `evictDurableObject` and the same namespace/name, comparing exact rows before/after; harness reset is not durability evidence.

## HTTPS browser fixture

`playwright.config.ts` owns `node scripts/start-ui-test-server.mjs` and graceful teardown. The script runs Wrangler's supported `createTestHarness`, starts ephemeral loopback TLS application/provider listeners and exact-authority CONNECT proxies, installs explicit synthetic grants through a binding, and verifies provider discovery, signed tokens and Worker authority before its stdout readiness marker. There is no competing URL readiness condition.

Configured HTTPS origins are `https://hub.fixture.example.invalid` and `https://issuer.fixture.example.invalid`, without ports. Browser routing admits only those two exact authorities on logical port 443; unknown hosts, alternate ports, direct loopback and ordinary HTTP proxy requests are rejected. Worker outbound requests use a separate exact discovery/token/JWKS URL and method dispatcher. Its Node TLS connection explicitly trusts the temporary provider certificate, verifies issuer hostname/SNI, and never follows redirects.

A temporary test-only Worker probe exercises the same harness outbound transport against the signed provider before readiness. The provider implements authorization code/query mode, PKCE S256 and confidential `client_secret_basic`; codes are short lived and single use. It uses ephemeral RSA keys and signed RS256 ID tokens. These helpers never enter the deployed source graph.

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

## Operator component and synthetic credential gates

The operator deployment has its own `workers/operator/wrangler.jsonc` and generated `workers/operator/worker-configuration.d.ts`. Generate it with `npx wrangler types --config workers/operator/wrangler.jsonc --env-interface OperatorEnv workers/operator/worker-configuration.d.ts`. Its generated ambient Env/GlobalProps declarations are included only by `tsconfig.operator.json` and `tsconfig.operator-test.json`; they must not merge into the app's compiler program. Shared DO code uses an explicit structural WorkspaceEnvironment.

`npm run typecheck` runs app/test, app production, operator production, operator Workers-test and browser UI targets. `npm test` includes the actual Node provisioning CLI suite. `npm run test:workers` includes current native grants and control-receipt storage; it excludes the Node CLI and separate operator gateway suites. `npm run test:operator` runs the real operator Worker with a separately named, bundled application Worker/SQLite DO owner. `npm run check` includes all these gates and schema-derived install validator freshness.

The Node CLI test launches actual subprocesses against a generated-certificate TLS fixture, verifies the Access service-header transport and forwards real signed assertions into the production gateway. Its exact-host request routing exists only in test preload modules. It does not alter the existing two-host HTTPS/browser fixture, global certificate trust or production transport.

The exact pins are recorded in package metadata, the lockfile, the runtime version file and CI. A fresh pinned `npm ci` and `npm ls --all` succeeded, and the UI build uses the installed platform binary. npm 11.19.1 reported that the esbuild/workerd dependency postinstall scripts were not approved; their optional platform packages supplied the tested binaries, and no automatic script approval was added. The operator CLI uses native createHmac plus timingSafeEqual. These observations do not establish a clean dependency inventory or imply that Node-specific advisories apply to workerd.

## Dependency gate remains blocked

The 2026-10-25 assessment is historical: it found affected Undici and Zod versions in the then-locked toolchain and bundled Wrangler/Miniflare distributions. On 2026-10-26 a clean pinned install reported zero installed-tree audit findings, but separate inspection still found Wrangler bundle markers for Undici 7.29.1 and Zod 4.6.5, Miniflare Zod 4.6.5, and npm's bundled Undici 6.28.0. These markers require advisory applicability and exact-byte review; installed-tree audit output does not cover or clear them. Track the unresolved gate in [R1-TOOLCHAIN #11](https://github.com/trungtaottn/cf-agent-hub/issues/11). Changing only a leaf lockfile entry would leave embedded code unchanged. The selected npm distribution also contains an affected bundled Undici copy. No override, downgrade or hand-edited vendor bundle is treated as a fix. CI runs the installed-tree audit; the release evidence gate additionally requires a complete reviewed embedded inventory. Runtime production reachability has not been established by this toolchain finding.

Resolve the coordinated toolchain update, regenerate its inventory, review the exact shipped bytes and rerun the candidate gates before real release use. Reference the official [Node 24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1) and the upstream Undici advisories [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472) and [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).
