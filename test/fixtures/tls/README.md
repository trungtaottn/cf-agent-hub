# Ephemeral TLS fixture

No certificate or private key is checked in. The Node-only helper creates fresh application/provider leaf keys and a separate invalid negative-test key in a mode-0700 temporary directory. Private key files are mode 0600 and deleted on normal shutdown, startup failure and SIGTERM/SIGINT.

Application and issuer canonical origins use the exact reserved example.invalid authorities documented in the toolchain runbook. The disposable browser's key-scoped SPKI exception admits only fresh app/provider keys; the CONNECT proxy independently confines destinations. Node provider requests trust the temporary provider certificate while retaining hostname/SNI verification. General TLS bypasses and system trust-store modification are forbidden.

Run `npm run test:ui` for actual approved-key, invalid-unpinned-key, unknown-host/port and direct-bypass checks. Startup readiness follows provider/Worker/installed-authority probes; teardown owns sockets, listeners, runtime and temporary key material. A browser unavailable on the current host is a failed or blocked gate, never a skipped success.
