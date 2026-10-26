# Contributing

Status: Contribution policy · R1 source implemented; isolated acceptance and release pending.

Contributions should make the product easier to implement, operate and verify. The current package contains R1 source, tests, design contracts and documentation checks, not a released application. The [feature matrix](docs/feature-matrix.md) and [R1 implementation record](docs/r1-implementation.md) distinguish implemented source from pending deployed acceptance. Keep implementation status accurate and use synthetic examples.

Coding and automation contributors must also follow the [repository agent guide](AGENTS.md). [AGENT.md](AGENT.md) is a pointer, not an alternate policy; product runtime-agent behavior is separately specified in [docs/agents.md](docs/agents.md).

## Choose the right change

For a wording correction, fix the canonical page and its affected links/examples together. For a behavior change, identify the relevant feature-matrix row, explain the user problem, describe compatibility and failure behavior, and update the canonical contract before implementing. Changes to identity, authorization, lifecycle, transaction boundaries or protocol semantics require an ADR or an explicit amendment to an existing one.

A feature proposal should name the actor, workspace scope, state transition, data ownership, retry/recovery behavior and observable acceptance criteria. “Add multi-agent support” is not precise enough; a claim race, credential rotation or review handoff is a testable slice.

## Reviewable changes

Keep a contribution focused on one coherent outcome. Include the reason for the change, the resulting behavior, affected contracts, validation performed and remaining limitations. Never report a runtime test as passing when only a schema or documentation check ran. Mark proposed source paths as planned until those files exist.

Before submission, run the documented checks in [documentation maintenance](docs/docs-maintenance.md). For implementation work, run the meaningful tests tied to the changed invariant in [testing](docs/testing.md). Do not add broad test suites that simply restate constants without testing behavior.

## Public content rules

Use generic identities and reserved example domains. Do not include credentials, actual invitation tokens, exported private activity, deployment account identifiers, internal incident logs or personal workspace presets. A secret scan is one check; review screenshots, fixtures, links, git history and archives for contextual disclosure as well.

Third-party code and assets require compatible licenses and retained notices. A project MIT license does not erase dependency obligations. Record attribution where it belongs rather than copying external documentation into the repository. Official external references are collected in [references](docs/references.md).

## Review and release

Reviewers check the contract, authorization, failure behavior and evidence, not just formatting. An adapter must not introduce a second domain implementation. A UI must not claim live or successful state without an authoritative source. A profile must not become a route around policy.

The maintainer accepts changes and decides release promotion using the [release checklist](docs/release-checklist.md). Repository source branches and beta/stable promotion follow the [branch governance policy](docs/branching-and-releases.md), which requires GitHub Rulesets to be active before PR-only enforcement can be claimed. No published issue tracker, support channel or repository URL is assumed by this design package; use the contribution channels advertised by the eventual public repository. Security findings follow [SECURITY.md](SECURITY.md).
