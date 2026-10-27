# Search continuation privacy comparison

Status: Implementation pending · Synthetic research evidence only · Selected technical recommendation · No runtime or live acceptance claim.

## Decision

Select authorized-only continuation with the existing hard ceiling of 2,000 examined candidates per request. Emit a cursor only after finding another authorized hit; bind its position to the last returned authorized record, not to a hidden scan frontier. If the candidate budget is exhausted before authorized lookahead or terminal high-water exhaustion is established, fail the entire request with generic 503 DEPENDENCY_UNAVAILABLE, without partial results or any progress cursor. Do not silently retry with a new frontier.

This explicitly supersedes the retained #21/#36 empty-filtered-continuation requirement. It does not weaken the 2,000-candidate cap or change #20 history's selected privacy rule. It accepts an MVP availability cost: hidden-heavy collections can prevent completing a search. Increasing the cap, introducing another cursor store or changing architecture is not selected here.

## Reproduction and evidence

Run `node compare.mjs` with Node 24.22.1. The script writes `results.json`, including timestamp, runtime and script SHA-256. Its pure ordered-array model is not a production search implementation, authorization implementation, SQL query or database benchmark. Visible flags represent fixed current grants. Array end represents reaching a previously established high-water ceiling, not reading an uncounted 2,001st candidate. Actual indexed seek/end/authorization work must be proven by #23/#36 before activation.

The executed model compares 11 adversarial cases and asserts identical successful authorized-only page contents/has_more across 6,561 hidden-insertion variants (three fixed visible records, zero through eight hidden records independently in all four gaps). Every request asserts examined candidates <=2,000. Public successful transcripts abstract encrypted cursor contents away; fixed-width encoding is a separate required protection, not an achieved property of this model.

With no visible records, candidate-frontier continuation changes from one terminal empty response (zero hidden candidates) to two successful empty responses (2,001 hidden candidates), then three (4,001). That is an observable hidden-cardinality/traversal side channel despite no explicit count field. Authorized-only continuation produces a terminal empty response when the fixed high-water ceiling is reached within budget; at 2,001 hidden candidates it returns only generic 503, not a successful progress page.

Visible-only data and hidden prefix/between/suffix cases whose required lookahead fits the budget produce identical successful public pages. Excessive hidden prefixes fail immediately. An excessive hidden suffix can fail a later request, but that failing response contains neither the already scanned authorized candidate nor a cursor. The result is successful-response noninterference within the model, not total observation noninterference.

## Threat model and residual leakage

The caller may vary query/limit, inspect returned data, has_more, cursor lengths, statuses and timings, and repeat reads. Protect hidden identities, snippets, explicit counts and hidden-dependent successful continuation transcripts. Keep authorization predicates before snippet projection and recheck current authority after cursor crypto as the runtime plan requires.

503 availability and timing remain observable side channels. In particular, a collection fitting within the cap can return 200 while a hidden-heavy collection returns 503. Generic errors do not erase this distinction. Do not describe this choice as eliminating hidden cardinality inference entirely, constant-time search, or guaranteed availability. Error responses must not carry counts, scanned IDs or partial results. No automatic progress token may turn failures back into a hidden traversal oracle.

The model does not prove bounded physical SQLite work: joins, indexes, authorization checks, sorting and high-water establishment may examine more rows than the logical candidates consumed. Actual runtime query/scan instrumentation and an enforceable bound remain activation prerequisites. A SQL LIMIT alone is not that proof.

## Cursor length experiment

The script also runs real Node WebCrypto AES-GCM with fresh nonces and synthetic non-secret inputs. A 1-byte versus 100-byte hidden ID yields 40 versus 139 plaintext bytes and 91 versus 223 base64url cursor bytes including nonce/tag. Illustratively padding both plaintexts to 256 bytes yields 379 encoded bytes in both cases. The illustrative padding is not a chosen wire format or production decoder; it demonstrates why encryption alone does not hide length.

Require fixed-width/padded shared search cursor encoding, bounded by the existing 2,048-byte cursor envelope, with correct AAD/current actor/query/kind/sort/high-water binding and existing absolute expiry. #23/#36 must prove maximum supported identifier/payload fit; do not invent an identifier length limit in this research.

## Source grounding

- `src/http/cursors.ts:33–34` encrypts variable-length canonical JSON, so current ciphertext length tracks plaintext length. The [WebCrypto specification](https://www.w3.org/TR/webcrypto/) defines AES-GCM ciphertext plus authentication tag; it does not provide traffic-analysis padding.
- `docs/adr/0008-r2-authority-and-history.md:25–35` already selects authorized-only continuation, whole-request failure under unproven work budget and padded history cursor encoding.
- `docs/superpowers/plans/2026-10-23-r2-durable-work.md` originally fixes 2,000 candidates and hidden-frontier continuation; the proposed amendment above openly replaces only the conflicting continuation rule.
- [SQLite expressions](https://www.sqlite.org/lang_expr.html) document LIKE wildcards and default ASCII case folding; raw LIKE is not the NFC case-sensitive literal query contract.
- [Unicode normalization](https://unicode.org/reports/tr15/) specifies NFC canonical equivalence; it is not compatibility/case folding.

## Required contract and future runtime assertions

Freeze NFC literal semantics, query bytes before/after normalization, 256-code-point snippets, unchanged closed SearchHit/Page and no totals. Successful pages require authorized lookahead; empty visible results terminate only after proven high-water exhaustion. Budget exhaustion returns generic whole-request 503 and no progress cursor. Retain message-inclusive proven truncation floors without applying them to task/artifact-only searches. Runtime owners must verify hidden-insertion successful-transcript invariance, exact candidate cap, physical-work feasibility, padded cursor length, revocation during crypto and no artifact-byte reads. These remain future product tests.
