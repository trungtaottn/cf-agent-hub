# Genuine schema18 recovery fixtures

Status: Synthetic historical fixture evidence only; no released capability or end-to-end R3 acceptance.

These are original schema18 encoder outputs from the immutable pre-migration baseline, not schema19 data converted or relabelled as18. No real operator action, deployment, retirement, cutover, install, publication or customer data is represented.

## Source identity and integrity

- Public repository: `trungtaottn/cf-agent-hub`, PR141.
- Public equivalent commit: `bfe621c3dab2a0cab672feadd1916ec154188db9`.
- Exact restored local detached commit used: `ad0f1b39a1431aa29726b5fc3b77c1a13e08118b`.
- Exact tree: `6c1e3df81b9b2ff72bb531438085a7d860b3182f`.
- All1432 original tracked files were hashed before capture and verified unchanged afterward. The complete inventory is `original-tracked-sha256.json`. No original production, test, migration, profile, lock or dependency file changed.
- The manifest release remains the existing helper's `synthetic_current_restore`. This is a synthetic declared build, not a deployed build attestation. The commit/tree and unchanged source inventory independently identify the code used.

`fixture-integrity.json` records exact delivered JSON hashes, the canonical signed manifest hash and unchanged genuine17 fixture hashes. Never regenerate, relabel, re-sign or edit these retained manifests, chunks, SQL job details or receipts. Capture ID is `capture_genuine18_e25c82edecd64b3cb6320dd13b9fa2ca`; random names are distinct from historical fixtures. New regeneration must use new random IDs and a new empty output directory.

| File | Contents |
| --- | --- |
| `genuine-schema18-bundle.json` | Original signed manifest/ledger, capture progress/ordinary receipt, exact SQL chunk bytes, exact committed artifact bytes, synthetic fixture authority inputs. |
| `genuine-schema18-snapshot-bundle.json` | Same capture plus actual captured-source SQL tables, sqlite_sequence, recovery/source-artifact/target-artifact R2 objects and declared release. |
| `genuine-schema18-restore-lifecycle-bundle.json` | Same capture plus actual physical18 target after17of34 imported chunks and completed physical18 target. Exact continuation indexes and progress retained. |
| `reproducer.tar.gz` | Test-only producer, local sink config and frozen replay verifier; existing baseline helpers are reused unchanged. |

Manifest and ledger HMACs are genuine original-code synthetic signatures. Ordinary capture/restore receipts are unsigned in the existing protocol; no fabricated signatures were added. R2 artifact objects are exact bytes authenticated through manifest digests, not individually signed objects.

## Coverage and limitations

The source projection contains104 rows across39 registered tables,34 chunks and50607 SQL bytes; one committed5-byte artifact (`hello`);3 tasks,2 runs,1 result/independent acceptance,18 events,1 message/artifact association, managed/archived agents, credentials/runtimes, pending/applied imports and catalog preview. One unconsumed creation reservation comes from the real local browser `tasks:prepare` route. One synthetic diagnostic slot/record is seeded using the existing observation repository helper and test SQL, exactly as in `observation-recovery.test.ts`; this is **not** evidence of observation HTTP ingestion. All ordinary history generation uses unchanged existing synthetic helpers/domain commands.

Captured source is closed `captured`. Partial target is closed `restoring`,17of34 chunks/76 imported rows, awaiting chunk17. Completed target is closed `restored`, physical18; creation reservations and diagnostic slots/records have been invalidated. DO eviction occurs throughout capture/import/verify and frozen replay.

The outbox is empty and event `creation_binding` values are NULL. This fixture does not demonstrate nonempty delivery-resolution graphs, consumed creation bindings, external adapter ingestion, new decision tables or end-to-end R3. Existing regression cases cover separate boundaries; do not attribute them to this fixture. The snapshot is a logical SQL/R2 export from real local SQLite Durable Objects, not a filesystem database image. Engine-owned alarm metadata is excluded. Snapshot operational job/chunk rows are not the earlier projected manifest counts.

All persisted URLs use reserved `example.invalid` hosts. IDs, sessions, proof hashes, identity/provider data and artifact bytes are synthetic repository fixtures. The synthetic signing key stays in the existing helper, not captured JSON. No real credentials, runtime logs, environment dumps or customer information are packaged. Fixtures must never be used as production authority.

## Reproduce or verify

Use a disposable checkout at the exact tree above with its locked dependencies. Verify `reproducer.tar.gz` against `reproducer-archive.json`, extract to a temporary directory and copy `reproducer/` contents into that checkout. `reproducer-sha256.json` records exact source contents. Copy the delivered three JSON fixtures into `test/fixtures/` for frozen verification.

For **regeneration only**, first change the new test-only config's destination to a new empty output directory. The sink uses exclusive creation (`wx`) and intentionally refuses to overwrite existing fixtures. Regeneration creates new IDs/timestamps/signatures, not byte-identical artifacts. Never use regenerated outputs in place of retained historical evidence.

```sh
XDG_CONFIG_HOME="$(mktemp -d /tmp/schema18-wrangler.XXXXXX)" \
  ./node_modules/.bin/vitest run --config vitest.schema18-capture.config.ts

XDG_CONFIG_HOME="$(mktemp -d /tmp/schema18-wrangler.XXXXXX)" \
  ./node_modules/.bin/vitest run --config vitest.workers.config.ts \
  test/recovery/schema18-frozen-verification.test.ts
```

The fresh empty XDG directory only supports local Wrangler initialization. No credentials are copied. A local Miniflare service binding writes JSON; no Cloudflare API or live operator request is made. Keep the producer/config/verifier archived rather than installing them in a future schema19 active test suite; that future suite must own its explicit historical compatibility tests. No current compiler/test exclusions were changed.

Runtime: Node24.22.1, locked `workerd1.20261019.1`, `@cloudflare/vitest-plugin1.4.7`, `Vitest4.1.12`, `Wrangler4.152.0`. Parent prepared unchanged-lock dependencies with pinned npm11.19.1; this capture worktree used an untracked symlink, direct binaries and made no dependency mutation. See `report.md` and `execution-receipt.json` for actual results. Local source evidence is not release acceptance or a live restore rehearsal.
