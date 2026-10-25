# R1 runtime evidence

Status: Evidence verifier implemented · Actual deployed R1 evidence and release acceptance pending.

`npm run verify:release -- --round R1 --evidence <path>` is a fail-closed
structural and byte verifier. It does not deploy, publish, restore, retire a
workspace, or authenticate a test run. The controller still inspects command
output and independent review. Unit fixtures under `test/acceptance` are
synthetic inputs to this verifier and are never runtime evidence.

Create `validation/releases/<release-id>/` only from actual verification runs.
The evidence must identify one committed candidate, its complete source
inventory (including modes, byte lengths and SHA-256 digests), the lockfile,
Node/npm versions, an explicitly isolated deployment, schema/config epochs,
command artifacts, all R1 gates and all 140 operation/credential-lane cells.
All referenced evidence files are bounded, hashed files inside that release's
directory. Paths cannot traverse directories or resolve through symlinks.
Uncommitted candidate changes, omitted files and changed bytes prevent release.

## Bindings between records

The closed shapes are defined in `validation/runtime-evidence.schema.json`.
The acceptance predicates are owned by `scripts/lib/release-policy.mjs`.

- `build.artifact` references the exact build bytes, their size and digest,
  backed by a successful build command. Both the independent review receipt
  and the deployment receipt must name that digest. Deployment environment,
  deployment ID, Worker version, workspace, object mapping, revision, tree,
  schema and epoch must all match the same candidate.
- The dependency receipt names the same revision, tree, lock digest, Node and
  npm versions. Its package inventory distinguishes installed, embedded and
  runtime packages. An incomplete embedded inventory or unresolved advisory
  fails the gate. Updating an installed dependency alone does not establish
  that a separately bundled copy was updated.
- The independent review receipt uses the closed `critical`, `important`,
  `minor` taxonomy. Unknown or malformed findings fail validation; any open
  critical or important finding blocks verification. The reviewer must differ
  from the implementation author and review the same source/build bytes.
- The recovery receipt binds the workspace, capture, source/target jobs,
  environments, object mappings and positive authority epochs. Source and
  target are distinct isolated environments; the target epoch must be greater
  and equal the release's current epoch. All required operation steps reference
  their own hashed, closed receipt, a successful deployed recovery command,
  the same recovery identity and exact policy-owned observations. Receipts are
  retained outside restored state. A complete capture alone is not a resume.

Aggregate feature gate outcomes are exactly `pass`. An evidence author cannot
change an expected failure into an acceptable success merely by setting
`expected` and `observed` to the same value. Negative scenarios inside a gate
must first satisfy their specific denial/no-mutation checks. Every route cell
also records its actual HTTP status, canonical error code (or null), response
contract/target checks, before/after SQL digests and exact mutation counts.
Missing routes, generic redirects, challenges and infrastructure failures do
not satisfy an authorization cell.

## Deterministic route matrix fixture

Use two installed workspaces A and B with distinct configured origins and
storage. Positive principals have current unrestricted grants and the required
scopes. Use valid bodies, current revisions, correct CSRF and fresh
idempotency keys. Initialize the schema and keep unrelated scheduler work
quiescent: dirty=0, no due/in-flight work and no concurrent alarm or sweep.

For message creation, use one addressed recipient, an existing authorized
thread, its existing participants, and no notification destination. This makes
its exact expected effect one message, one inbox entry, one accepted event and
one outcome. Delivery and new-thread behavior have separate required gates.
For ACK, seed one unacknowledged message for the current recipient. Profile
and preference writes advance only the relevant revision by one, with one
event and one outcome. Preview and all successful reads perform no persistent
mutation. Denied requests perform none either; unrelated scheduler repair must
not be hidden by a broad mutation allowance.

The seven lanes are:

1. `ungranted_human`: a genuine prior cookie with its grant disabled (or no
   usable session) on protected routes. Callback instead carries genuine OIDC
   identity for a subject without an enabled grant.
2. `valid_human`: a current session with its required scope and valid CSRF.
3. `expired_session`: a genuinely expired session. Callback additionally uses
   a new valid OIDC flow for that enabled principal.
4. `valid_native`: a current enabled bearer with native scope and required
   participation/recipient access.
5. `revoked_native`: the same genuine credential after disable/retirement.
6. `wrong_workspace`: A's session at B using B's valid origin. Callback uses
   A's attempt/state/cookie at B. Start uses B's target with A's Origin.
7. `conflicting_lanes`: Authorization plus a cfhub_session cookie.

Start is anonymous same-origin login admission; unrelated expired/revoked
credentials do not authorize it or prohibit a valid new flow. A successful
start creates one pending login attempt; the matrix contains no expired
attempt to prune. Callback requires a real one-use code and matching state and
login cookie. The two positive callback cells include the prior session cookie
(valid or expired), consume one attempt, issue one session and revoke that
prior session. Native callback cells have no human login proof and must fail.
A successful callback is the exact safe return-path redirect with the required
session cookie attributes, not an arbitrary redirect.

Public liveness returns canonical JSON `{"status":"alive"}` in every lane.
Protected readiness may correctly return `ready:false` before a probe: that
passes endpoint authorization, but does not pass the separate operational
readiness gate. Native-only operations/readiness return 403; conflicting
credential lanes return 400. Exact statuses are in the reviewed policy table.

## Privacy and promotion

Do not record bearer values, cookies, private keys, private origins or personal
fixture data. Receipt metadata uses neutral stable IDs and content digests;
protected row chunks and operator inputs remain outside public evidence.
A release verifier failure leaves evidence available for diagnosis and never
triggers rollback or deletion. Correct the missing implementation/evidence and
record a new candidate. Verified and Released remain separate: publication
requires its own authorized repository and operator promotion gate.
