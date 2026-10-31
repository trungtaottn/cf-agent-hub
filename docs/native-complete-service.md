# Fixed private native fixture service

Status: implemented source attachment; installed authority, full native conformance and formal acceptance remain pending.

The source entry is `workers/native-fixture/complete-service.ts`. It exports the
fixed service Durable Object, private required controller, and projection-only
workspace attachment. The example Wrangler file is deliberately incomplete:
it has no public route, production resources, credentials or default authority.
It is not an instruction to deploy.

## Operator-owned inputs

An isolated installation must supply its reviewed deployment configuration and
private resource bindings (`WORKSPACE`, `CONTROLLER`, `COMPLETE_SERVICE`, artifact
and recovery storage, and the required recovery-anchor binding). The configured
service and target HTTPS origins must route to this fixed service entry. No
arbitrary forwarding URL or public SQL endpoint is accepted.

Trusted service bindings are `NATIVE_CONFIG`, `NATIVE_TRUST_ANCHOR`,
`NATIVE_INSTALLATION`, `NATIVE_AUTHORITY`, `NATIVE_PRIVATE_INPUTS`, `NATIVE_HUMAN`,
`NATIVE_TOKEN_S`, `NATIVE_TOKEN_R`, `NATIVE_TOKEN_X`, and
`NATIVE_SERVICE_KEY_PKCS8`. The last is the canonical base64 encoding of the
48-byte Ed25519 PKCS8 key whose public key is pinned by the signed installation.
These are operator inputs, not incoming request fields. Never commit their
values or include them in a public report or source backup. The client private
key is not a service input.

The fixed host separately requires the guarded authority record at
`/etc/agenthub-native/complete-authority.json`, bounded to 1,024 bytes, with the
existing root ownership and non-writable-parent checks. A hash in configuration
is not a grant: the actual record bytes, signature chain, exact capabilities,
config commitment and original lease must all verify. Current checks reread the
actual record; replacement poisons the run.

## Lifetime and ownership

Only the fixed singleton accepts a canonical, client-signed first preflight.
Authentication precedes its once-only durable run claim and controller effects.
A claimed object cannot resume after restart. No request can select an imported
module, credential path, controller name or SQL query.

The wrapper admits one control-body reader at a time. It retains ownership of
actual reads and cancellation promises. Core cleanup cannot certify unresolved
wrapper ingress: no successful closed response is published while such ownership
remains pending or failed. Rejected bodies for which no reader was acquired
remain native Worker transport-owned; the harness makes no claim that those
unaccepted transports were drained. Application/HOLD response ownership remains
with the existing fixed application bridge, not this control-body latch.

## Validation status

The local tests use ephemeral signed test bindings and isolated workerd objects.
They do not install trust, execute the protected native CLI, or constitute native
acceptance. The fixed Worker entry has actual local preflight and acquired-ingress
ownership coverage. These bounded tests are not a full required-profile run; a
source build or import alone is not a successful service run. Three tuple-only cases remain unverified and deferred to
R4 under the dated owner decision; they are not generated passing observations.

The transport adapter bounds all incoming header names/values before projecting
only the existing control-protocol headers. A finite list of harmless transport
metadata is ignored; forwarded IP/protocol and Cloudflare metadata never establish
origin or authority. The actual Request URL and the existing Host/proof checks
remain authoritative. Cloudflare documents these added headers in its
[HTTP header reference](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

Miniflare's Node-side proxy restores the requested URL while its transport can
retain a different Host. The actual local positive ingress test therefore uses
a fixed, test-only workerd driver with a service binding to the unchanged default
Worker and Durable Object. This preserves a genuine native Request URL/Host pair
without repairing supplied wrong-host values or disabling validation. It proves
service-binding behavior, not external HTTPS ingress or installed TLS identity.

The separate local source integration completes the required 64-slot schedule
using real primary/foreign Durable Objects, ordinary product authentication,
57 application requests, selected SQL captures, scanner projections, E1/E2,
human revocation, and a one-second unpublished HOLD/disarm. It finalizes scanning
and closes cleanly. CLI execution, custody/store/journal and local artifact
retention attestations in that test are synthetic inputs; this is not an
installed or native conformance run and does not prove the native timeout horizon.
