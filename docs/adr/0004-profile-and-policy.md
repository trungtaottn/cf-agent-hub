# ADR 0004: Separate profile, preference and policy

Status: Accepted design direction · Contract revision 0.1 · Implementation pending.

## Context

Users need different names, navigation, appearance, project catalogs and work roles. Portable presets are useful, but a broadly trusted configuration object could also redirect storage, alter identity or grant permissions. Replacing entire catalogs can break task references.

## Decision

Define four typed layers: deployment/authentication, workspace policy, workspace profile and user preferences. Appearance resolves through neutral defaults, an allowed workspace profile and allowlisted user overrides. Security policy is evaluated independently as a ceiling. All objects use closed schemas; prohibited and unknown fields fail atomically.

Project and work-role entries use stable IDs and explicit archive/remap behavior. Import is an upsert; omission is not deletion. Fresh catalogs are empty. Examples are opt-in and contain no credentials, memberships or activity. Hiding a view does not disable the underlying task engine or erase pending obligations.

## Alternatives considered

A single unrestricted settings object is convenient for a prototype but makes profile sharing a trust boundary. Hard-coded personal branding prevents reusable deployment. Replace-all catalog import is easy to implement but loses references and audit meaning.

## Consequences and evidence

Configuration has more deliberate ownership and validation, while presets become safe to inspect and share. Custom themes and assets are limited to the explicitly versioned schema; arbitrary script/CSS injection is not a profile feature. User preference cannot expose a forbidden resource.

Acceptance includes forbidden-field rejection, stable-ID reimport, referenced archive behavior, allowed precedence and secret-free export. See [configuration](../configuration.md), [customization](../customization.md) and [design guidelines](../design-guidelines.md).

## Local issue 28 implementation clarification — 2026-10-27

A reviewed catalog preview is immutable evidence, not authority. Exact profile revision and complete referencing ID/version equality are rechecked inside the workspace transaction; known-row-only comparison is insufficient because new references can appear. No lock spans human review and no policy rewrite is implicit. Public remap changes show destination identity explicitly. Archive retains references; remap rejects live or approved intent. Duplicate labels receive an additive advisory `DUPLICATE_NAME` conflict code; every other profile-preview conflict remains blocking. See [research and measured alternatives](../r2-task-plans/research/r2-catalog-lifecycle.md) and [catalog semantics](../customization.md#local-catalog-operation-semantics).
