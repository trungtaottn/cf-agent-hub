# R3 typed source-observation consistency

Status: Partial source implementation; independent source review and integrated checks pending. Not runtime acceptance, deployment verification, or a supported product action.

`validateR3SourceObservations` in `scripts/lib/r3-source-observation-validator.ts` consumes bounded serialized envelope bytes, a Map of referenced bytes, and separately supplied serialized comparison context. Its only supported profile is `r3-j1-source-v1`: all six fixed J1 observation cases are required. It statically calls the existing closed J1 predicate rather than copying its domain schema.

All results set `acceptance_eligible: false` and `provenance_authenticated: false`. `source_profile_complete` concerns only six internally consistent local observations. The producer has eight Workers tests: six observation cases and two private-state/budget guards. This API does not infer those test executions from six artifacts or claim an authenticated producer/build receipt.

Matching source, environment, descriptor, policy, installation and actor comparison context establishes consistency only. Configuration fields absent from the observation are not invented as measured values. J1 recovery observations retain their original restored-maintenance-barrier meaning; they do not establish post-resume authority. J2 is unsupported until its exact schema, producer and integration are reviewed.

Input budgets are checked before referenced-byte reads. The API uses intrinsic Map operations, detached byte copies, closed JSON transport schemas, exact case/path/type/digest bindings and the unchanged bounded R2 loader. It rejects shared/resizable byte stores, unknown files, unsafe paths, duplicate observation claims and invalid encodings. Identical content at distinct source-file paths is allowed. Errors expose fixed codes, not supplied payloads or exceptions.

No producer exporter, production RPC, CLI release round, or release-schema registration is added. Actual runner-owned export/receipt transport, supported action execution, installed client positive parity, authenticated source/build/controller origin, predecessor acceptance, independent whole-round review and formal isolated #67 acceptance remain missing. Hand-authored validator test inputs are unit evidence only. Existing R1/R2 and prerequisite verifier branches are unchanged.
