# Fixed complete native fixture profile

Status: source development; complete factory integration and native acceptance pending.

This is an additive source contract for issue 48, not an installed service, a
successful native run, or release acceptance. Existing configuration version 1,
static service version 2, R1 evidence, and native case requirements are unchanged.

## One profile, separate units

`native-r2-complete-prepared-v1` is a closed profile inside version 2. Its source
manifest contains all 68 scenario steps, both external obligations, 56 process
windows and 27 input publications. It does not offer a smaller reader-only profile.

The compiled ledger reserves **489 logical commands**, **46 mutation attempts**,
**174 artifact bytes** and **22,890,667 cumulative logical output bytes**. Commands
are not OS processes: they include scenario, evidence, service and bootstrap
admissions. An uncertain attempt is not refunded. Service calls (370), application
HTTP requests (57), private SELECT admissions (2,555), canonical private bytes
(7,888,422), process output bytes (188,416), and two-pass scanner raw bytes (376,832)
are different dimensions. None is a peak-memory or universal product-limit claim.

The fixed artifact is the 29 UTF-8 bytes `Native conformance artifact.` followed by
one newline. The six logical artifact windows reserve 174 bytes. Product support
for larger or empty artifacts is unchanged; this particular fixture is nonempty.

Release packing remains separately bounded by 512 originals, 65,536 bytes per
original and the cumulative 16 MiB cap. The selected ledger plans 509 originals,
a separate structural fragment and reference-only wrapper, totaling 11,019,596
bytes. Logical work includes repeated transfers and therefore exceeds release
size. These are reviewed reservations, not produced evidence or measured native
performance. No complete report is emitted by these new contract modules.

## Configuration and commitments

`validateCompleteConfig` is a separate structural validator. It accepts only
version 2 with the exact profile and compiled canonical `fixture_sha256` and
`family_ledger_sha256`. The eventual report field `ledger_sha256` is a different
schema field, not an accepted configuration alias. The fixture manifest pins
source recipe identities, constrained substitutions, fixed labels and configuration
choices, the exact SQL catalog and process output offers. Actual fixture state,
installed trust, current grants and protected custody still require independent
admission; matching a digest does not establish them.

The configuration contains exactly ordered submitter/reviewer actors and one
separate `server-foreign-workspace` store using the same submitter identity. No
native X actor/store or tuple-only replacement stores are silently provisioned.
Paths must be normalized and nonoverlapping. The complete validator uses bounded,
descriptor-only copies and rejects proxies, accessors and unknown fields before
using them. It does not replace or relax `validateNativeConfig` version 1.

Duration 1–300,000 ms is only a structural range. Actual installed remaining
lifetime, ordinary 60-second run lease, 90-second runtime presence and cleanup
requirements remain independent. No hidden heartbeat, renewed authority or
successful 300-second run is implied.

## Private selected-state component

`workers/native-fixture/selected-state.ts` runs only the 34 source-owned literal
SELECT definitions against supplied owned Durable Object storage. It atomically
reserves an entire phase before SQL, uses guarded bounded projections and overflow
lookahead, enforces each selector's narrower fixture canonical cap, and poisons on
failure without refund. Actual keyed outcome identities come from a bounded SQL
index, not a response-derived filter. Retaining a local artifact does not invent
server observations.

This is a private source component, **not an installed Worker endpoint**. It makes
no authentication, grant, fixture-membership or semantic admission claim. The
future coordinator must bind actual prepared identities and causality, and divide
the global reservation between P/F readers. Creating two readers with each full
allowance does not enforce a shared global budget. Local workerd tests exercise
real SQLite, while callback lifecycle adversarial tests use an explicitly labeled
source fake; neither establishes an installed independent observer.

## Remaining mandatory gates

The full run is unavailable while the three tuple-only controls have no authentic
producer: slot-only, generation-only and principal-only replacement. The source
capability guard rejects them before effects; caller `supported: true` assertions
cannot override it. No owner waiver or native requirement change is included here.

The complete fixed service, phase controls, recorder/report-2 dispatch and protected
entry composition still require implementation and integration. Actual eligible
runtime/store custody, independent installed trust and existing operator-provided
materials remain deployment inputs, not something this source contract creates.
Formal acceptance after R4 does not turn these unfinished code paths into a pass.
