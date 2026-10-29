# Local synthetic read-only preview

Status: local development preview; deployed acceptance pending, no released-feature claim.

This development-only viewer displays the actual built UI and real local Worker
responses over loopback HTTP. Its isolated SQLite Durable Object and emulated R2
contain synthetic fixture data. It is **not production login, authenticated native
CLI conformance, deployed acceptance, or a writable sandbox**.

With the repository's pinned Node and installed locked dependencies:

```sh
npm run build:ui
mkdir -p .superpowers/tmp/preview-xdg
XDG_CONFIG_HOME="$PWD/.superpowers/tmp/preview-xdg" WRANGLER_SEND_METRICS=false \
  node scripts/start-ui-test-server.mjs --preview-readonly
```

Use the `http://127.0.0.1:<port>` origin printed after
`CFHUB_LOCAL_PREVIEW_READY`; open `/tasks` in a browser **on the same host and
network namespace**. The ordinary HTTPS test fixture origin printed separately
is not this viewer URL. No certificate-warning bypass, public tunnel, browser
installation, or global TLS override is needed. Stop with Ctrl-C in the owning
terminal. Do not combine this mode with self-check flags.

The synthetic session remains inside the fixture adapter. The viewer does not
accept browser credentials or forward browser cookies/authorization. It exposes
only fixed same-origin GET/HEAD paths, strips Set-Cookie and Location, refuses
redirects and mutations, and bounds body size, response time and concurrent work.
The visible read-only banner is intentional. UI write controls may still appear;
the viewer refuses their requests rather than granting write authority. Login,
logout and artifact-byte download routes are unavailable. Do not enter secrets.

A trusted fixture adapter normalizes Miniflare's Response realm into Node's
Response while preserving the body stream and cancellation. The generic viewer's
strict Response check remains intact. Synthetic GETs use the fixture's existing
seeded session, not a new OIDC login claim.

Verification:

```sh
node --test test/preview/readonly.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The initial pure-source tests missed Miniflare's distinct Response realm; a real
Miniflare regression now covers normalization, header stripping, redirects and
stream cancellation. Root-owned browser observation is separate from these tests.
