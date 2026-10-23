# ADR 0006: Evidence-based public release claims

Status: Accepted design direction · Contract revision 0.1 · Implementation pending.

## Context

A complete-looking interface or documentation site can imply capabilities that are still mocked, partially designed or untested. Operators and client developers need to know which guarantees are available in a specific release and which remain plans.

## Decision

Maintain a capability matrix with Specified, Implemented, Verified and Released statuses backed by concrete evidence. This package starts entirely at Specified. Separate documentation validation from runtime tests and distinguish protocol targets from certified compatibility. Use release gates that prioritize identity/reliability, durable multi-agent work, human decisions/adapters, then teams/extensions.

Public documentation is self-contained, uses neutral synthetic examples and links to actual assets. A released quickstart must be reproduced on a fresh environment before publication. The license is MIT with maintainer attribution in the license file. Third-party licenses and notices remain independently applicable.

## Alternatives considered

A single unqualified feature checklist is shorter but hides partial behavior. Publishing a speculative install command creates avoidable operator failure. Copying a live operator's configuration into examples may speed drafting but embeds private context and unsafe defaults.

## Consequences and evidence

Release maintenance includes updating contracts, examples, status and operational evidence together. Users can distinguish design intent from an available product. A disabled feature must remain visibly unavailable instead of silently presenting synthetic success.

See [feature matrix](../feature-matrix.md), [release checklist](../release-checklist.md), [documentation maintenance](../docs-maintenance.md) and [contribution policy](../../CONTRIBUTING.md).
