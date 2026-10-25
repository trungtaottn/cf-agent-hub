# R1 static credentials and operator installation

Status: Implemented offline provisioning and authenticated installation; live provider, deployment and recovery acceptance pending.

This runbook describes the implemented offline provisioning and authenticated installation boundary. It does not establish deployment or release acceptance. The pinned Node 24.11.0 runtime is admitted only for synthetic development; Task 11 must verify and adopt a supported Node 24 security patch and rerun release gates before real operator credentials are used. See [toolchain](toolchain.md).

## Authority and token handling

A static participant is an identity record. Its name and work role grant nothing. Each enabled credential reference explicitly specifies its workspace, agent, allowed R1 scopes, project ceiling and expiry. A token is 32 random bytes encoded as unpadded base64url. Only its SHA-256 hash is stored in the authenticated verification bundle and protected workspace SQL. Native proof preparation hashes outside SQL; every effect and replay must call the shared current-authority resolver/authorizer inside its transaction. Retained tokens remain valid under newer configuration only while their latest installed records allow the operation and resource.

A token grants no runtime, task, enrollment, credential-issuance or administration authority. Human authentication remains a separate lane. Human sessions are bound to their installed positive auth epoch; a greater configuration epoch invalidates previous-epoch sessions. Scopes cached by a Worker, cookie or earlier ActorContext never replace current SQL authority.

Provisioning requires a POSIX filesystem with protected regular files, restrictive owner permissions, exclusive creation, hard links and fsync. Keep the operator working directory outside the repository at mode 0700. Protected input files must be owned by the current user, have no group/other permissions and have one hard link. Symlinked paths are refused. Reveal output must be a regular, empty, single-link file owned by the caller at exactly mode 0600; stdin, stdout, stderr, pipes and terminals are refused. The caller must reserve that file exclusively. An inherited descriptor cannot prove that an empty file did not exist before the caller opened it.

The helper stages each new bundle as an exclusive 0600 sibling, handles short writes, fsyncs the file, publishes with an atomic no-replacement hard link, then fsyncs the directory. It never overwrites an existing destination or changes a prior bundle. Failed staging removes temporary files. A failed or lost reveal is not recoverable: retain its metadata, issue a replacement under a new ID, and retire the old ID. Never put bearer values, signing keys or Access service secrets on the command line.

## Protected integrity and operator files

The integrity descriptor reads exactly this private JSON shape:

```json
{"key_id":"operator_bundle_key","key_base64":"<base64 encoding of 32–128 random bytes>"}
```

The key is generated and retained in protected operator storage. This is local configuration, not a public API request. HMAC-SHA256 authenticates canonical bundle JSON excluding only `auth.tag`; the key ID and algorithm are authenticated too. The Node helper uses native `createHmac` and `timingSafeEqual`, not the old Node WebCrypto HMAC comparison. The Worker uses its runtime WebCrypto HMAC verification. Key material is never copied into the bundle.

An install operator file has exactly these fields:

```json
{
  "origin": "https://operator.example.invalid",
  "environment_id": "reviewed_environment",
  "workspace_id": "ws_example",
  "allowed_workspace_ids": ["ws_example"],
  "service": {
    "client_id": "<Access service Client ID>",
    "client_secret": "<opaque protected Access service secret>",
    "principal_id": "deployment_operator"
  },
  "integrity_key": {
    "key_id": "operator_bundle_key",
    "key_base64": "<protected base64 key>"
  },
  "operation_id": "install_epoch_one",
  "expected_authority_epoch": 0,
  "reason": "Reviewed initial installation"
}
```

Each file selects one reviewed environment through its exact HTTPS origin and configured service identity. The workspace must be in the explicit local allowlist. The origin must be canonical HTTPS on the default port with no credentials, query or fragment. The helper verifies bundle HMAC/config binding before network access, sends the Access Client ID and opaque secret on every request, refuses all redirects and does not use a cookie. Both legacy and newer Access secret formats are treated as opaque. The TLS peer and returned workspace, object mapping, epoch, installation digest, operation ID and configured operator principal must match. Responses and network operations are bounded.

The separate operator Worker requires the secret bindings `OPERATOR_POLICY` and `BOOTSTRAP_INTEGRITY_KEY`. The latter is the base64 key from the protected integrity file. `OPERATOR_POLICY` is a closed JSON object:

```json
{
  "environment_id": "reviewed_environment",
  "origin": "https://operator.example.invalid",
  "access_issuer": "https://team.cloudflareaccess.com",
  "access_audience": "<operator application AUD>",
  "bundle_key_id": "operator_bundle_key",
  "workspace_catalog": [
    {"workspace_id":"ws_example","object_name":"workspace-example"}
  ],
  "services": [
    {
      "client_id":"<Access service Client ID>",
      "principal_id":"deployment_operator",
      "environment_id":"reviewed_environment",
      "workspace_ids":["ws_example"],
      "operations":["install"]
    }
  ]
}
```

Every catalog mapping in the reviewed payload must match this environment's explicit catalog. The signed service `common_name` maps exactly to the configured principal; it is never sanitized into a principal ID or inferred from a name/header. The gateway verifies RS256, exact issuer/AUD, required current time claims, `type=app`, and the service `sub=""`. Human assertions, unsigned Client ID headers, product sessions and native bearers cannot authorize it. JWKS is obtained only from the configured issuer's `/cdn-cgi/access/certs`, with bounded time/body and no redirects or stale-key fallback. Access Service Auth policy and origin-bypass/revocation checks remain deployment acceptance obligations.

## Create, overlap, retire and install

Use reviewed configuration and protected bundles conforming to [deployment](../../spec/deployment-config.schema.json) and [bootstrap](../../spec/r1-bootstrap.schema.json). Every active hash must have exactly one configured reference. A fresh ID must name a configured participant, and its supplied expiry must exactly match the configuration and be in the next 90 days.

Reserve a reveal file without clobbering any existing path and open the integrity file by descriptor:

```sh
umask 077
set -C
exec 3> /protected/operator/credential-a1.token
exec 4< /protected/operator/integrity.json
node scripts/provision-static-credential.mjs create \
  --initialize --config /protected/operator/config-1.json \
  --workspace ws_example --agent agent_research \
  --credential-id credential_research_1 --expires-at <reviewed-RFC3339-expiry> \
  --secret-output-fd 3 --integrity-key-fd 4 \
  --bundle-output /protected/operator/bundle-1.json
exec 3>&-
exec 4<&-
```

`--initialize` is only for empty authority. The config must contain exactly the credentials supplied by the resulting bundle; the helper does not manufacture missing tokens. An empty-native configuration can use `assemble --initialize` without reveal arguments.

To add another participant or overlap a replacement, advance the config epoch, keep existing references, and add one new ID. Use the same `create` form with `--prior-config /protected/operator/config-1.json --prior-bundle /protected/operator/bundle-1.json` instead of `--initialize`. Select a fresh reveal descriptor and a new bundle destination. Prior HMAC, config digest and epoch are verified before mutation. Retained hashes and permanent tombstones are preserved. An existing ID cannot be rebound to another actor or regenerated; retirement requires a new ID for subsequent use.

After installing and verifying the replacement's required access, advance the epoch again and remove the predecessor reference. Run:

```sh
exec 4< /protected/operator/integrity.json
node scripts/provision-static-credential.mjs assemble \
  --prior-config /protected/operator/config-2.json \
  --prior-bundle /protected/operator/bundle-2.json \
  --config /protected/operator/config-3.json \
  --retire credential_research_1 --integrity-key-fd 4 \
  --bundle-output /protected/operator/bundle-3.json
exec 4<&-
```

`assemble` forbids all fresh-token/reveal arguments. Config-only changes omit `--retire`. Repeated `--retire` options select distinct IDs; an ID ambiguous across workspaces is refused. Tombstones retain the original workspace, actor, hash and retirement epoch through all later bundles. Keep historical participants in the reviewed catalog while their tombstones refer to them. Dropping a hash without explicit retirement fails.

For each result, install using a protected operator file with the original stable operation ID and expected current epoch:

```sh
node scripts/provision-static-credential.mjs install \
  --operator-config /protected/operator/install-3.json \
  --config /protected/operator/config-3.json \
  --bundle /protected/operator/bundle-3.json
```

Install accepts only these three arguments. It does not generate or reveal tokens, assemble new material, or accept client-supplied operator context/digest fields. Ordinary output is sanitized metadata or an authenticated receipt; errors contain no input values. The helper does not retry automatically.

## Installation, replay and acknowledgement

The wire envelope remains the closed [recovery install discriminant](../../spec/recovery-command.schema.json): `operation,workspace_id,capture_id:null,expected_authority_epoch,operation_id,reason,payload:{config,verification_bundle}`. It is limited to 65,536 UTF-8 bytes.

The installation digest is SHA-256 of canonical `{config,credentials,retired_credentials}`, with both credential arrays sorted lexically by workspace ID and then credential ID. Config digest remains the hash of the complete canonical reviewed config. Existing SQL digests are read as stored for CAS; the corrected digest calculation does not rewrite old authority or accept an alternate historical format.

The gateway authenticates service identity, operation/environment/workspace allowlists and bundle integrity before consulting a receipt. It obtains the current installation digest over the trusted DO binding, preserving the caller's expected epoch. The strict internal context includes stable operation ID, canonical request fingerprint and verified service-proof expiry. Fresh request ID and proof expiry are excluded from the stable intent fingerprint. After asynchronous preparation, the transaction rechecks proof expiry and current maintenance/retirement admission.

Inside one transaction:

1. An original matching operation/fingerprint returns its immutable receipt before stale expected-epoch/digest CAS.
2. The same operation key with any changed canonical request conflicts, including changed reason, expected epoch or payload.
3. An unseen operation requires exact current epoch/digest CAS and a strictly greater new config epoch. Skipped epochs are allowed.
4. Authority changes, the sanitized configuration event and operator receipt commit together.

A different operation ID with already installed same-epoch/same-digest material is a new non-advancing install and is rejected. A returned old receipt proves the original install; it does not claim that its epoch is still the latest. Current authorization and admission are rechecked even for original replay.

Control receipts use `idempotency_outcomes` with key `(principal_id, operation="operator.install", target=workspace_id, key=operation_id)`. They are retained permanently in R1 (`expires_at=Number.MAX_SAFE_INTEGER`), beyond the minimum 24 hours. Task 11 must exclude this namespace from restored domain idempotency and preserve the target's own operator control history. Captured/imported rows must never create active operator replay authority. No forward migration is needed for this namespace.

Only the separately configured operator Worker has the production binding used by this route. The gateway owns Access/HMAC verification. The binding hop revalidates closed context/payload, target mapping and full digest; it does not invent a second secret or treat TypeScript brands as cryptographic proof. The lower-level binding-only reconciliation method retains its original semantics for trusted bootstrap fixtures, but the external gateway exclusively calls the strict operation adapter. Public HTTP cannot select either internal method.

Revocation is complete only after every affected workspace acknowledges the higher epoch. Until then, pause affected admission/delivery and keep revocation pending. The next admitted command against the acknowledged current authority denies disabled or retired credentials, including cached identities and same-principal replay attempts whose current credential lacks scope or visibility. Effects already sent to remote systems cannot be recalled. Actual authenticated capture/restore and exclusive-authority cutover remain Task 11 work; synthetic old-state/current-ledger tests only establish the auth/bootstrap boundary. R2 must migrate these IDs, hashes and permanent revocation history without granting dynamic administration or reviving retired credentials.

## Implementation and verification map

- Native proof/current grants: `src/auth/native.ts`, `src/auth/authorize.ts`.
- Protected CLI: `scripts/provision-static-credential.mjs`, `scripts/lib/{protected-io,bundle-integrity,operator-install}.mjs`.
- Gateway and verifier: `workers/operator/src/index.ts`, `workers/operator/wrangler.jsonc`, `src/recovery/operator.ts`.
- Schema-derived install validator: `scripts/generate-operator-contract.mjs`, `src/recovery/generated/install-validator.{js,d.ts}`.
- Trusted storage adapter: `src/workspace/{context,workspace-do}.ts`, `src/config/bootstrap.ts`.
- Node CLI tests: `test/auth/operator-provisioning.test.ts`.
- Workers current grants/control receipts: `test/auth/static-grants.test.ts`, `test/storage/operator-install.test.ts`.
- Actual two-Worker cryptographic gateway tests: `test/auth/operator-gateway.test.ts`, `vitest.operator.workers.config.ts`.
- Separate operator production/test compiler scopes: `tsconfig.operator.json`, `tsconfig.operator-test.json`, generated `workers/operator/worker-configuration.d.ts`.

Run `npm run check` for generation, all four compiler scopes, contract, Node, app Workers and operator Workers gates. The CLI TLS harness and exact-host preload are confined to test helpers; deployed source and CLI production modules import neither. Browser and real deployment acceptance remain separate gates.
