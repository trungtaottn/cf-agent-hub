# Issue 29 stacked publication reconciliation

Status: Source-equivalent draft preparation; remote checks and live acceptance pending. No released capability.

This publication preserves the reviewed claim/lease implementation from local commit `6362ebbd6b63acba02aab946a83fc43111167804`. Its source, tests, contracts, schema and dependency locks are unchanged. The first publication parent is actual issue 28 draft PR103 head `53bab6bdcfcf502b40e5040da85a3ef420f4d1cd`; the second is the original issue 29 planning tip `701500d030dbf78d24f09572f25c1d73992606c1`. This retains the native issue branch history without force updating a ref.

The source evidence and limitations remain in [execution evidence](issue-029-execution.md). Inherited corrected plans and contributor guidance from the actual predecessor remain intact. No successor task failure/expiry/cancellation composition is included: public claim/run exposure stays unavailable until issues 30 and 31 integrate those boundaries. Dirty scheduler state is not itself an activated lease scheduler.

Publication uses the owner's sequential MVP amendment: draft pull requests are allowed without routine reconfirmation, but merge, deployment and release are not authorized. Live acceptance is deferred until after R4, not waived. Historical local aggregate passed 813 Node, 818 Workers, 18 operator and 13 deployment-verifier tests, then failed at the unchanged protected recovery CLI output guard (8 passed / 18 failed). Browser assertions were not run. These are not all-green aggregate or live acceptance claims.

The publication controller retains exact input/output hashes, product equivalence, independent review, focused checks and remote receipts outside this source tree. Remote CI is measured for the actual published revision; a local result is not represented as a remote run.
