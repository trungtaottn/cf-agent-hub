# Genuine schema17 recovery fixtures

Status: Synthetic historical fixture evidence only; no released capability. B1 integrated acceptance remains pending.

Synthetic, local source-test evidence only. These are **original schema17 encoder outputs**, not schema18 data relabelled as17. No real operator action, deployment, source retirement, cutover or release is represented.

## Source identity

- Repository: `trungtaottn/cf-agent-hub`, public PR138.
- Public equivalent commit: `77ee610c13a61077dc866a66556eafdfcb1d2553`.
- Exact local detached commit used: `e427ab862183527516daba5dd53e78d1222a8dce`.
- Tree: `3c6eb659c6ad6d30ddd30bc6b22500d819a6c73a`.
- All1338 original tracked files were hashed before capture and verified unchanged afterward. `original-tracked-sha256.json` preserves that inventory. No original production, test, migration, lock or dependency file was edited. Only new test-only producer/config/verifier files and new fixtures were added. Nothing was staged, committed or published.
- The signed manifest's `release` is the existing test helper's `synthetic_current_restore` declaration. It is deliberately retained exactly. The commit/tree above establish original encoder provenance; the manifest is not a real deployed build attestation.

## Contents and integrity

`fixture-integrity.json` records exact SHA-256 file hashes, the canonical signed manifest hash and unchanged original schema16 fixture hashes. Preserve the delivered JSON bytes; never re-sign or relabel these historical manifests, chunks, SQL job details or receipts.

| File | Purpose |
|---|---|
| `genuine-schema17-bundle.json` | Original signed manifest, capture progress/receipt, exact chunk bytes, exact artifact bytes and synthetic fixture authority inputs. |
| `genuine-schema17-snapshot-bundle.json` | Same capture plus actual captured-source SQL tables, event sequence, recovery R2 objects, source/target artifact R2 objects and declared release identity. |
| `genuine-schema17-restore-lifecycle-bundle.json` | Same capture plus actual physical17 target snapshots after16of32 imported chunks and after completed restore. Progress and exact continuation indexes are retained. |
| `reproducer.tar.gz` | Test-only source used to capture plus frozen verification tests. Existing repository helpers are reused unchanged. |

The capture contains101 projected rows across37 registered tables,32 chunks,48033 SQL bytes and one5-byte committed artifact (`hello`). The schema17 source has one real, unconsumed browser `tasks:prepare` reservation. Domain histories include3 tasks,2 runs, a result and independent acceptance,18 events,1 message with artifact association, managed/archived agents, credentials/runtimes, catalog preview and applied/pending import plans. The completed restore has no creation admissions and remains closed in `restored` maintenance. The partial target has71 imported rows,16 imported chunks and awaits chunk16.

The capture has **no outbox rows** and all existing event `creation_binding` fields are NULL. It is not evidence for a nonempty paused-delivery graph or a consumed creation binding; existing current-controls/admission-flow tests separately cover those paths. The pending admission is genuine original17 HTTP preparation, not hand-inserted SQL.

SQL snapshots intentionally include operational capture/restore jobs and chunk rows that are not part of the earlier projected manifest table counts. Snapshots are logical table/R2 captures from real SQLite DO execution, not filesystem SQLite images. Engine-owned alarm metadata is not exported as product data.

## Reproduce (new random output, not byte-identical)

Use a disposable checkout at the exact source tree with its existing locked dependencies. No dependency installation, credential copy or security setting change is needed for the supplied environment.

1. Verify `reproducer.tar.gz` against `reproducer-archive.json`; its exact source contents retain the hashes in `reproducer-sha256.json`. Extract into a temporary directory, then copy into the disposable original17 checkout (not the current18 checkout):

   ```sh
   mkdir -p "$TEMP_REPRODUCER"
   tar -xzf /path/to/genuine-schema17-provenance/reproducer.tar.gz -C "$TEMP_REPRODUCER"
   cp -R "$TEMP_REPRODUCER/reproducer/." /path/to/disposable-original17-checkout/
   ```

   Copy the three delivered JSON fixtures (in the parent `test/fixtures/` directory) into that checkout's `test/fixtures/` when running the frozen verifier. The archive avoids compiling original17-only test helpers as current18 source; no active test or compiler configuration is excluded.
2. For **regeneration only**, edit the test-only config's `destination` to a new empty output directory. Do not overwrite this delivered fixture set. Run:

   ```sh
   XDG_CONFIG_HOME="$(mktemp -d /tmp/schema17-wrangler.XXXXXX)" \
     ./node_modules/.bin/vitest run --config vitest.schema17-capture.config.ts
   ```

3. Verify the delivered frozen fixtures without regenerating:

   ```sh
   XDG_CONFIG_HOME="$(mktemp -d /tmp/schema17-wrangler.XXXXXX)" \
     ./node_modules/.bin/vitest run --config vitest.workers.config.ts \
     test/recovery/schema17-frozen-verification.test.ts
   ```

4. Run the original regression files listed in `report.md`, and compare original tracked-file hashes again.

The fresh `XDG_CONFIG_HOME` is empty and used only for local Wrangler log/config initialization. No credentials were copied. The producer writes JSON through a test-only local Miniflare service binding; it does not make a real Cloudflare or operator request. Domain setup and capture use unchanged production code; source, target and R2 state are synthetic and local. DO eviction occurs throughout capture/import/verification. The frozen verifier reinstalls actual SQL/R2 snapshots, evicts the DO, then uses the original recovery implementation to continue or control them.

Random IDs, system timestamps and expiry values are deliberately not fixed. A regeneration should produce equivalent synthetic histories and valid original17 signatures/checksums, **not identical fixture bytes**. Use the delivered fixtures and their hashes for compatibility regressions. Verification helpers create synthetic current-time external authority records only when testing local resume; they are never claims of real retirement/cutover.

## Execution environment and limitations

Actual local `workerd1.20261019.1`, `@cloudflare/vitest-plugin1.4.7`, `Vitest4.1.12`, `Wrangler4.152.0`, Node`v24.22.1`; existing npm is`11.9.0` rather than package.json's declared`11.19.1`. No npm install or npm-driven dependency mutation was performed; direct existing binaries ran the tests. This is focused recovery evidence, not a full exact-head release gate or live recovery rehearsal. Review `report.md` for actual outcomes and initial test-helper mistakes.

All persisted fixture URLs use reserved `example.invalid` hosts. All identities, hashes, proofs, sessions, configuration, provider data and artifact bytes originate from the repository's synthetic test helpers. The fixture set contains no real credentials, environment dumps or runtime logs. The synthetic integrity key remains in the existing test helper, outside the captured JSON. These fixtures must never be used as production authority.
