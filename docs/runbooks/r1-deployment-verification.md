# R1 deployment observation and external proof

Status: R1 implementation candidate · Isolated deployment verification pending; no released artifact.

`scripts/verify-r1-deployment.mjs` records a finite set of actual HTTP observations against one explicitly configured isolated target. It validates product responses with the canonical generated DTO validators and uses the existing `readinessFromResponse` promotion helper. It is an observer, not a deployment, identity-provider, revocation or recovery controller.

The observer intentionally cannot produce an overall release pass. Its HTTP subset may pass, but the separately named external workflow gates remain pending until the release owner verifies those workflows through the existing O2/O3 process. A supplied session cookie, a denial response or an artifact digest alone does not establish those proofs.

## Protected inputs

Pass configuration and credentials as already-open file descriptors. Each descriptor must refer to an owner-only regular file (0600 or stricter, current owner, one hard link). The configuration is closed JSON, at most 65,536 bytes. Unknown fields, caller success flags, descriptor reuse and production/default targets are rejected. The three credential files each contain only the opaque 43-character token, optionally followed by one newline. Do not put a Cookie or Authorization header in a credential file.

```json
{
  "format_version": 1,
  "environment_class": "isolated",
  "environment_id": "isolated_fixture",
  "target": {
    "origin": "https://hub.example.invalid",
    "workspace_id": "ws_fixture",
    "object_name": "workspace_fixture",
    "authority_epoch": 2,
    "human_principal_id": "human_fixture",
    "native_principal_id": "agent_fixture",
    "native_agent_id": "agent_fixture",
    "foreign_origin": "https://foreign.example.invalid",
    "alternative_origins": ["https://preview.example.invalid"]
  },
  "candidate": {
    "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "tree_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "bundle_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "deployment_id": "deployment_fixture",
    "worker_version": "worker_version_fixture",
    "schema_version": 7
  },
  "credentials": {
    "allowed_session_fd": 4,
    "forbidden_session_fd": 5,
    "native_bearer_fd": 6
  },
  "external_receipts": []
}
```

All example identifiers and domains above are synthetic. Supply the reviewed isolated target and its current authority epoch. Origins must be exact canonical HTTPS origins with no userinfo, port, path, query or fragment. The alternative-origin inventory is explicit and bounded to eight entries; the script does not discover or assume account routes. A null credential descriptor leaves that credential's gates pending. An empty alternative inventory also remains pending.

Use disposable isolated sessions for the two negative logout probes. Those probes send a missing-CSRF request and a foreign-Origin request, followed by a session read. A 403 by itself is not evidence that SQL did not mutate.

```sh
umask 077
node scripts/verify-r1-deployment.mjs \
  --config-fd 3 --output isolated-observations.json \
  3<protected/deployment.json \
  4<protected/allowed-session \
  5<protected/forbidden-session \
  6<protected/native-bearer
```

No credential is read from an environment variable or command-line value. The observer refuses redirects, never sends the supplied credentials to alternative origins, and does not log response bodies, CSRF values, tokens, private origins, actor IDs or workspace IDs. Each request has a five-second deadline and a 262,144-byte streamed response limit. There are at most 23 sequential requests; no automatic retry or external mutation controller is present.

## What the HTTP subset establishes

| Observation | Required result |
| --- | --- |
| Public liveness | HTTP 200 and canonical `Liveness` DTO |
| Anonymous workspace read | HTTP 401 and canonical authentication error |
| Supplied allowed human session | Canonical current human session, expected principal and unexpired session |
| Human workspace read | Expected workspace and actor with `workspace:read` |
| Human readiness | The existing promotion helper's complete, fresh readiness checks |
| Human operations | Canonical operations DTO, expected epoch/schema, and independently validated embedded readiness |
| Supplied forbidden session/workspace | HTTP 401 or 403 with canonical denial DTO |
| Native workspace read | Expected workspace, agent actor and `workspace:read` |
| Native readiness | Exactly HTTP 403 with canonical forbidden error |
| Cookie plus bearer | Exactly HTTP 400 with canonical invalid-request error |
| Missing CSRF / foreign Origin | Exactly HTTP 403 with canonical forbidden error |
| Session after negative logout probes | The expected session still reads successfully |
| Native foreign Origin | Exactly HTTP 403 with canonical forbidden error |
| Each configured alternative host | An anonymous workspace request receives HTTP 401, 403 or 404; no redirect is followed |

Alternative-host results are explicitly HTTP-denial observations; an edge response is not application readiness. Main product denials additionally require canonical JSON and the expected error category. A login challenge, HTML 401, unrelated 404, malformed DTO, wrong workspace/actor, stale probe or empty readiness check list cannot pass the corresponding product check.

## Required external workflows

The output always names the following pending gates. The release owner must associate real workflow evidence with the exact reviewed candidate and deployed target before promoting R1.

1. **`oidc_provider_journey`** — Exercise an actual isolated authorization-code flow through the configured provider, token endpoint, issuer, audience, keys and callback. Record allowed and forbidden human results and actual signature/issuer/audience rejection cases. A supplied session proves only the current session request; it cannot prove how that session was issued.
2. **`acknowledged_next_request_revocation`** — Establish successful use of the original human/native authority, apply the reviewed revocation through the existing operator installation workflow, retain its authoritative acknowledgement/epoch, then issue the next request with the old authority and verify denial. A preexisting invalid token or a caller assertion that revocation happened does not satisfy this gate.
3. **`actual_operator_recovery`** — Use the existing `recover-workspace.mjs` CLI and gateway against isolated resources. Verify encrypted capture bytes, signed manifest and current ledger; restore while paused; reconcile uncertain effects; record actual probes; and require source retirement/cutover before exclusive target resume. Retain the actual CLI/operator receipts. This observer creates no recovery jobs, retirement, cutover, resolution or redrive.
4. **`deployed_bytes_provenance`** — Independently compare the platform deployment/version and built artifact bytes with the reviewed revision/tree/bundle. The observer's `requested_candidate` is a binding to intended inputs, not evidence that the running deployment has those bytes. Use the release owner's existing promotion and manifest checks.

Optional `external_receipts` entries are closed `{kind,fd,sha256}` records. `kind` is one of `oidc_journey`, `revocation`, `operator_recovery`, or `deployment_binding`. Each protected file is bounded to 1 MiB; its actual bytes must match the supplied digest. The script records only kind, byte size and digest with `assurance:"bytes_only"`. This permits linking real encrypted CLI artifacts without exposing them. It deliberately does not decrypt them or treat embedded `passed:true`, status fields or a matching digest as verified workflow proof. The corresponding external gate remains `EXTERNAL_WORKFLOW_REVIEW_REQUIRED` for the release owner.

## Evidence and exit status

The output file is created exclusively with mode 0600, synchronized, and never overwritten. It is bounded to 65,536 bytes. Evidence contains actual status/content-type class, bounded byte count and digest, canonical-DTO/binding conclusions, the verifier/contract digests and hashed private target/deployment identity. It retains no raw response or request secret.

- Exit **1**: an observed check or input/artifact binding failed.
- Exit **2**: the run remains pending because credentials, target configuration, route inventory or independently verified external workflows are missing.
- The observer does **not** emit an overall success exit. A passing HTTP subset is reported separately; the existing release verifier owns promotion after all required proof is inspected.

With no real target input, the following produces an immutable pending record without issuing network requests:

```sh
node scripts/verify-r1-deployment.mjs --output blocked-observations.json
```

## Focused local checks

```sh
node --test test/deployment/verify-r1-deployment.test.mjs
```

These tests use an explicitly injected synthetic transport. They verify response interpretation, target/actor binding, credential separation, redirect and byte bounds, protected FD/output handling, and refusal to promote external workflow claims. They are local verifier tests, not deployed IdP/operator acceptance evidence.
