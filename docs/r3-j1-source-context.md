# J1 pre-command source context v2

Status: Implemented local source profile; actual v2 eight-case exporter, separate consumer, combined-capacity probe and v1 regression passed. Final review/integration pending. Not release acceptance.

This separate local profile captures a bounded safe context from installed source fixture configuration before domain setup, awaits the immutable context sink outside the Durable Object, and compares that context to the later six command-generated J1 observations. The recovery target is prepared-only at capture. Its policy must match the immutable source policy; its later object/epoch can be compared, but the existing observation does not independently attest a final target installation digest.

The fixed profile `j1-context-v2` selects the dedicated eight-case J1 module, not a filtered superset. An absent profile retains the v1 path; any other value rejects before fixtures. Six cases produce one observation and one pre-command context each. Two guards remain payload-free. All eight final test/module/run states, no retries/repeats/skips/errors, child CLOSE 0 after teardown, and unchanged measured source/config/toolchain are mandatory. The controller stages 13 inputs (manifest+12 payloads) and atomically publishes one complete execution record; filename existence alone is not validation.

`validateJ1ContextSource(executionBytes, {files, expectedSourceBytes})` is a bounded consistency API. Its expected source is separately retained pre-child controller context, never reconstructed from outcomes or the submitted execution record. Exact source files and staged inputs are digest-checked, then the shared domain/context predicates and role-specific joins run. Source files may legitimately share hashes or be empty; observation/context aliases and empty payloads are rejected. The checked Map is not a filesystem root. The private caller still supplies both claims and comparisons: this does not authenticate execution.

Logical observation 262144/context 8192, serialized individual metadata 360448/16384, combined metadata 380928, source 256 files/32MiB, six context bytes 49152, and overall output 2MiB are unchanged fixed caps. Producer preassignment bounds and bounded host processing do not protect against arbitrary hostile framework RPC allocation before callbacks.

Eligibility and provenance authentication remain false. Unsupported product actions, live independent actors/provider lineage, installed positive native/MCP parity, complete recovery rehearsal, prior-round acceptance, independent round review, J2 transport and formal #67 remain separate. npm is declared/unexecuted, install origin unverified, product build null. Historical v1 limitations/receipts are not rewritten. No production registry or release dispatcher changes are part of this profile.

## Actual local checkpoint

On `8619f50866eb5e40933d2a9d52f057af41b0aae9`, the v2 controller completed eight tests and six observation/context joins, with child CLOSE 0 and no signal/error. Its execution record SHA-256 is `04ea46360eb23073d5cc68699b514095f1ebf7deed262b8b22b2bf444fda44b7`. A separate actual consumer test checked those output files against the retained pre-child input context and all 225 measured source references; eligibility/authentication stayed false. The measured graph contained 221 inputs plus four explicit roots; the canonical schema was inventoried once, without graph-path omission. An earlier pre-child attempt failed on mismatched JSON import attributes and is retained separately, not counted as execution.

A separate two-test synthetic RPC probe transported 262144 observation bytes plus 8192 context bytes: 349528/10924 base64 characters and 360930 combined serialized metadata bytes. Context 8193 was rejected before either assignment. This measures supported logical maxima, not domain validity or the conservative 380928-byte boundary itself. The unchanged v1 controller also passed its eight tests/six observations on that same source revision; historical v1 records were not rewritten. Private outputs are not embedded in this document.

Launch the fixed controller only from a pristine committed checkout with pinned dependencies and an empty inherited environment:

```sh
env -i PATH=/usr/bin:/bin /absolute/path/to/node scripts/r3-source-context-producer.mjs
```

The controller takes no profile/config/filter arguments. Exact profile selection comes from `vitest.r3-source-context-producer.config.ts`; no production runtime or release dispatcher is activated.
