# Maintaining the documentation contract

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This package treats documentation, schemas and examples as one reviewable contract. A change is complete only when its canonical reference, dependent pages, machine-readable shapes and acceptance expectations agree. The included validator checks these documentation assets; it does not execute product behavior.

## Canonical ownership

| Concern | Authoritative asset | Dependent assets to inspect |
| --- | --- | --- |
| Product status | [Feature matrix](feature-matrix.md) | README, roadmap, release checklist and UI claims |
| Task state and ownership | [Task lifecycle](task-lifecycle.md) | Data model, Kanban, API, scenarios and adapters |
| Native wire contract | [HTTP API](http-api.md) and [OpenAPI](../spec/openapi.json) | HTTP fixtures, CLI and adapter mappings |
| Authentication/authorization | [Security model](security-model.md) | Every route, client, deployment and recovery runbook |
| Configuration and appearance | [Configuration](configuration.md) and `spec/*.schema.json` | Profiles, user preferences, customization and import behavior |
| Numerical defaults | [Limits](limits.md) | Schema bounds, API prose, retry/lease implementation and boundary tests |
| Design rationale | [ADRs](adr/README.md) | Any contract changed by a new decision |

If prose and schema disagree, resolve the discrepancy explicitly. A schema can enforce types and allowed fields; it cannot alone prove authorization, byte size, referential integrity, per-ID uniqueness, state transitions or transaction semantics.

## Run documentation checks

From this package's root, use an isolated Python environment:

```bash
python3 -m venv .venv-docs
.venv-docs/bin/python -m pip install -r requirements-docs.txt
.venv-docs/bin/python scripts/validate_docs.py
```

These are real documentation-tooling commands for files included here. They require Python 3.11 or later and installation access to the pinned top-level dependencies. The delivered validation report records the environment actually used. The virtual environment is local tooling and must not be included in a public archive.

To write a new machine-readable report after a change:

```bash
.venv-docs/bin/python scripts/validate_docs.py --report validation/report.json
```

The script parses every Markdown/JSON asset, checks local links and heading anchors, checks status markers, validates JSON Schemas and OpenAPI, validates mapped fixtures, verifies key security/state shape requirements and runs negative configuration/schema cases. It reports what it actually checked and exits nonzero on failure. Fixture mappings live in [validation configuration](../validation/fixtures.json). Update that mapping when adding a new example.

## Review beyond automation

Manually review auth semantics, state transitions, retry/restore races, protocol mappings and operational advice. Search public artifacts for private identities, credentials, deployment domains and accidentally bundled working notes. Use a private denylist when checking excluded project-specific terms; do not embed those terms in the public validator itself. Inspect archives after packaging as well as the working folder.

The validator does not contact external links, render Mermaid diagrams, scan every possible secret format, run a server, validate a protocol implementation or prove Cloudflare recovery behavior. Those limits must remain in the report. A syntactically valid OpenAPI document can still express an unsafe authorization rule; independent review is required.

## Example conventions

All fixture identities and origins are synthetic. HTTP files model individual request or response shapes; they are not an executable sequence against an available service. Task scenario files describe semantic acceptance cases and are not HTTP bodies. Configuration/profile fixtures are portable envelopes, not deployment manifests or automatic settings operations.

Never put a usable credential in an example. One-time native/runtime secrets are represented only by explicitly synthetic fixture strings where needed. Keep input digests and artifact metadata consistent when examples claim they refer to each other. Avoid presenting unmeasured limits as throughput or an SLA.

## Packaging and change control

Package only the intended docs, schemas, synthetic fixtures, validator, license and validation metadata. Exclude local environments, downloaded reference material, private notes and source snapshots. A package manifest records each included file's relative path, byte size and SHA-256; regenerate it after final validation. The manifest excludes itself from its hash list.

For an implementation release, add reproducible runtime evidence and update statuses only for capabilities actually verified. Keep the documentation-only validation report distinct from product test output. Record incompatible changes and chosen protocol versions in the changelog, and verify the published quickstart in a fresh environment before release.
