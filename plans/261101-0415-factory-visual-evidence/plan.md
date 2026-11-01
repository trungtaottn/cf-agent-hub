# Factory synthetic visual evidence plan
Status: planned evidence-only lane; no product behavior or release change.

Goal: capture actual desktop/mobile browser screenshots of all three Phase A surfaces on immutable product77ee610c13a61077dc866a66556eafdfcb1d2553/tree3c6eb659c6ad6d30ddd30bc6b22500d819a6c73a, then retrieve/view artifacts before any visual-quality claim.

Architecture: isolated evidence branch, existing registered ci.yml workflow with explicit manual boolean; ordinary checks unchanged unless manual visual mode explicitly selected. Separate product and driver checkouts; no production source modifications. Existing real-session HTTPS synthetic fixture/pinned browser only. No new permissions, credentials, live data, public listeners, merge or deploy.

- [ ] RED governance test pins manual-only mode, ordinary gates, source SHA and narrow artifact paths.
- [ ] Add screenshot-only test/config, with visible readiness assertions; preserve production source and normal suite.
- [ ] Add manual lane and positive/negative workflow dispatch conditions; old release-dispatch tests retain green.
- [ ] Typecheck/list/strict diff and independent review immutable five-file delta.
- [ ] Publish evidence branch without modifying PR138; dispatch existing registered workflow at evidence ref.
- [ ] Download native artifact ZIP, verify receipt/image hashes and source/workflow revisions, view actual desktop/mobile PNGs. Record findings or explicit remaining gaps; no DOM-only visual claim.

Review focus: branch-vs-source SHA mismatch, manual flag bypassing ordinary PR gates, screenshot upload leaking nonfixture files, early screenshot before data ready, mobile overflow/poor hierarchy. Fixed filenames and synthetic fixture only; no traces/cookies/session storage uploaded. Screenshots are evidence, not generated substitutes.
