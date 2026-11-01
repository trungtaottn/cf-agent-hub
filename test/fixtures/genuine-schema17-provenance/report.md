# B1 Task1 — Original schema17 fixture capture report

Status: Synthetic historical fixture evidence only; no released capability. B1 integrated acceptance remains pending.

## Scope and source

Completed a genuine schema17 local recovery fixture capture before any migration18 existed in this isolated checkout. Exact detached local HEAD`e427ab862183527516daba5dd53e78d1222a8dce`, tree`3c6eb659c6ad6d30ddd30bc6b22500d819a6c73a`, equivalent supplied public PR138 commit`77ee610c13a61077dc866a66556eafdfcb1d2553` in`trungtaottn/cf-agent-hub`.

No original tracked file changed. All1338 original tracked SHA-256 values match`original-tracked-sha256.json` after execution. `git diff --exit-code`, `git diff --cached --exit-code`, and `git diff --check` all exited0. No migration18, source behavior edit, staging, commit, publication, installation, credentials/config copy, live operator action or real Cloudflare deployment occurred. New test-only files and immutable synthetic JSON fixtures are the only additions, apart from the provided existing node_modules symlink.

## Delivered artifacts

- `genuine-schema17-bundle.json`: SHA-256`d0d644570bbafefdb70cf7a14e7ee6423915c25b8af7efc6be60acc4ed0bca4a`.
- `genuine-schema17-snapshot-bundle.json`: SHA-256`ae56ad75c572d3f44d9fc30f2e8f57389c1e1e2b10a13b51314c849ac77ff5bf`.
- `genuine-schema17-restore-lifecycle-bundle.json`: SHA-256`a1941c46700256b53d233df68df21c5f69c29a574b5fb581c121f864fe290ac2`.
- Canonical signed manifest SHA-256`6dba0866f88ca9fd061bf171a872647a6fa58c69f1015c59c8ab5c57dc030c18`.
- `fixture-integrity.json`, original tracked-file inventory, exact test-only capture/verifier sources under`reproducer/`, reproducer hash inventory and sanitized`README.md`.

All three capture objects are structurally identical, including the original manifest/signature/chunks/receipts/artifacts. No fixture was regenerated after the first successful producer or after consumers began copying. Existing genuine schema16 fixture hashes remain unchanged and are recorded in`fixture-integrity.json`.

## Actual evidence

Original production code ran in local workerd using the existing Cloudflare Vitest integration, real SQLite Durable Object storage, actual R2 buckets, and DO eviction throughout capture/import/verify. The source history uses unchanged existing rich fixture/domain commands plus a real `object.fetch` browser`POST tasks:prepare` call; the pending reservation was not hand-inserted SQL.

- Schema17 / contract0.2;37 registered tables,101 projected rows,32 original encoded SQL chunks,48033 SQL bytes.
- One committed5-byte artifact with verified exact source/recovery/target bytes.
- Source:3 tasks,2 runs,1 result,1 independent acceptance,18 events, message/artifact associations, managed and archived agents, credentials/runtimes, catalog preview, applied/pending imports and one unconsumed creation admission.
- Captured-source snapshot: closed`captured` maintenance, original capture job/chunk state, full product SQL/event sequence/recovery and artifact object bytes.
- In-flight target: physical17, closed`restoring`,16/32 imported chunks,71 imported rows, continuation at chunk16.
- Completed target: physical17, closed`restored`, original retained17 manifest/job/receipt, zero creation admissions.
- Original manifest and ledger HMAC signatures, manifest schema shape, chunk SHA-256/byte sizes/schema tags, ordered stream SHA-256 and artifact SHA-256/byte sizes all verified with original code.
- Ordinary capture/restore receipts are **not signed records** in the original protocol. Their exact original bytes are retained and original receipt validators used; no signatures were fabricated.

The test release declaration is exactly existing`synthetic_current_restore`; this is not a deployed source identity attestation. Provenance ties the original code/tree to execution separately.

## Commands and terminal results

Each Wrangler/Vitest invocation used its own fresh empty`XDG_CONFIG_HOME` made with`mktemp -d`. Tests were invoked directly from existing`node_modules/.bin` binaries; no dependency changes.

| Command | Actual result |
|---|---|
| `vitest run --config vitest.schema17-capture.config.ts` | Exit0;1file/1test passed;11.16s. Produced all three immutable fixtures. |
| `vitest run --config vitest.workers.config.ts test/recovery/schema17-frozen-verification.test.ts` | Exit0;1file/5tests passed;13.89s. |
| Final combined frozen verifier + original regression run listed below | Exit0;7files/33tests passed;95.62s (28 original cases +5 frozen fixture cases). |
| `tsc -p tsconfig.worker.json --noEmit` | Exit0; original production Workers types. |
| `tsc --noEmit` | Exit0; full configured source/tests/config types including new test-only helpers. |
| Original tracked-file SHA-256 comparison and unchanged Git diffs | Exit0;1338/1338 identical; no staged changes. |

Final combined command:

```sh
XDG_CONFIG_HOME="$(mktemp -d /tmp/schema17-wrangler.XXXXXX)" \
  ./node_modules/.bin/vitest run --config vitest.workers.config.ts \
  test/recovery/schema17-frozen-verification.test.ts \
  test/recovery/current-restore.test.ts \
  test/recovery/current-controls.test.ts \
  test/recovery/creation-admission-snapshot-flow.test.ts \
  test/recovery/schema16-restore-upgrade.test.ts \
  test/recovery/schema16-restore-continuity.test.ts \
  test/recovery/schema16-frozen-controls.test.ts
```

Frozen verification actually reinstalls captured SQL/R2, evicts and checks untouched fresh17 restore, partial-import continuation/completion, changed revision/worker-version denial with identical retained jobs, captured-source probe and exact permanent retirement replay, and completed-target probe and exact synthetic-authorized resume replay. Final target admissions remain empty. The original admission-flow regression additionally proves source resume can retain and consume its genuine pending admission while restored lost-future authority cannot be replayed.

Initial test-helper failures were diagnosed and fixed without source changes: trying to verify an unsigned ordinary receipt as signed, using global`DigestStream` instead of workerd's`crypto.DigestStream`, and a verifier assertion typo`results` instead of`task_results`. An initial combined run passed all28 original regression cases and4of5 new cases; the remaining assertion typo was corrected and the frozen5/5 rerun passed. A type-only ledger literal cast was added for JSON-import inference. Delivered fixture bytes were never edited by those verifier fixes.

## Safety, limitations and next pickup

All fixture state is synthetic and all persisted URLs use reserved`example.invalid` hosts. No real credentials, identity/provider payloads, environment dumps, private source paths or raw runtime logs are embedded. The test signing key stays in the existing helper, not the captured JSON. Unknown random IDs/timestamps are not claims of reproducible exact bytes. These files are not production authority.

The captured outbox is empty and all existing event creation bindings are NULL; do not claim this fixture itself covers nonempty delivery resolution or consumed-binding preservation. Those paths have separate original controls/admission regression evidence. Snapshot table counts include later recovery operational rows and intentionally need not equal the earlier exported projection counts. Engine-owned alarm metadata is excluded. Test-only local capture is not live freshness, deployed restore, release, or full B1 acceptance.

Next: independent provenance/content review and immutable copy into the schema18 implementation tree; add genuine17→fresh18 and retained physical17 captured/in-flight/completed lifecycle tests without modifying original signed evidence. Resume may migrate only at the reviewed authorized transition; wrong declared builds must remain denied. No live operations are authorized by this report.
