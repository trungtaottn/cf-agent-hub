# Phase1 — policy and bounded IO

Status: source implemented and independently reviewed; final regression infrastructure-blocked and live acceptance pending.


Status: implemented, focused tests passed and independently reviewed.

Owner: controller for loader/schema dispatch; source-contract delegate for source-derived policy only after interface approval. Existing R1 files/fixtures/exports stay behaviorally exact; dispatch format1/R1 versus format2/R2 before any branch-specific parsing. Unknown combinations fail.

Freeze54 canonical supported facade operations and their permitted lanes/status/proof contracts,322 independently enumerated isolation phases from existing matrix, plus source-backed non-route gate cases. Required table membership for successful authorized writes is not exact delta; denied/read/otherworkspace observations require exact no-change where source asserts it. Never infer intended authorization cause from generic403 without relevant current grant/proof and positive control.

ArtifactRef={path,sha256,byte_size}; no raw command lines, URLs, logs, secrets or arbitrary evidence prose. Root4MiB; source2048files,16MiB/file,32MiBtotal; component16MiB/blob,32MiBtotal; evidence4MiB/file,16MiBtotal; commands128,64KiBprojection;256unique refs. Bounds reserve cumulatively before disk reads/allocation. Typed category aliases reject. Same ref can be reused only with same type/hash/size/category and counted once. FatalUTF8/noBOM. Protected disk reads reject traversal/symlinks/nonfiles, use descriptor identity and exact-size read with growth probe. Root schema validated before any refs are followed. Map-based test API uses identical budget and digest validation.

Tests before implementation: original25 R1 characterization; unknown/mixed dispatch; oversized root before read; exactbound/oneover cumulative source/component/evidence, refcount/commandcount; malformedUTF8/BOM; refalias/type/digest conflict; path/symlink; omitted/extra sourceinventory; unchanged R1 schema fixture behavior. Preserve existing R1 audit caps.

Compare eager read-all versus pre-reserved lazy typed loading with a reproducible synthetic byte-count/allocation study; measure exact JSON escaping rather than assuming stringlength equals bytes. Per-kind maxima do not guarantee simultaneous cumulative admission.
