#!/usr/bin/env python3
"""Validate documentation assets only; this does not run CF Agent Hub."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.metadata
import ipaddress
import json
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from jsonschema import Draft202012Validator, FormatChecker
from markdown_it import MarkdownIt
from openapi_spec_validator import validate as validate_openapi
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parents[1]
MD = MarkdownIt("commonmark").enable("table")
ERRORS: list[str] = []
CHECKS: dict[str, int] = {}
GENERATED_DIRECTORIES = {"node_modules", "dist", "test-results", "playwright-report"}


def check(condition: bool, label: str, category: str) -> None:
    CHECKS[category] = CHECKS.get(category, 0) + 1
    if not condition:
        ERRORS.append(label)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def walk_tokens(tokens):
    for token in tokens:
        yield token
        if token.children:
            yield from walk_tokens(token.children)


def heading_anchors(tokens) -> set[str]:
    anchors: set[str] = set()
    counts: dict[str, int] = {}
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or index + 1 >= len(tokens):
            continue
        inline = tokens[index + 1]
        text = "".join(t.content for t in (inline.children or []) if t.type in {"text", "code_inline"})
        slug = re.sub(r"[^\w\- ]", "", text.lower(), flags=re.UNICODE).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        anchors.add(f"{slug}-{count}" if count else slug)
    return anchors


def validate_markdown() -> tuple[int, int]:
    documents = sorted(p for p in ROOT.rglob("*.md") if not any(
        part.startswith(".") or part in GENERATED_DIRECTORIES for part in p.relative_to(ROOT).parts
    ))
    parsed = {path: MD.parse(path.read_text(encoding="utf-8")) for path in documents}
    anchors = {path: heading_anchors(tokens) for path, tokens in parsed.items()}
    external_count = 0
    for path, tokens in parsed.items():
        rel = path.relative_to(ROOT).as_posix()
        content = path.read_text(encoding="utf-8")
        check(content.startswith("# "), f"{rel}: missing H1", "markdown_structure")
        first_lines = content.splitlines()[:6]
        check(any(line.startswith("Status:") and ("pending" in line.lower() or "no released" in line.lower()) for line in first_lines), f"{rel}: missing accurate baseline status", "markdown_structure")
        check(len(re.findall(r"^# ", content, flags=re.M)) == 1, f"{rel}: multiple H1 headings", "markdown_structure")
        for token in walk_tokens(tokens):
            if token.type not in {"link_open", "image"}:
                continue
            target = token.attrGet("href" if token.type == "link_open" else "src")
            if not target:
                continue
            url = urlsplit(target)
            if url.scheme or url.netloc:
                check(url.scheme == "https", f"{rel}: unsupported/non-HTTPS external link {target}", "link_schemes")
                external_count += 1
                continue
            resolved = (path.parent / unquote(url.path)).resolve() if url.path else path
            check(resolved.is_relative_to(ROOT), f"{rel}: link escapes package: {target}", "local_links")
            check(resolved.exists(), f"{rel}: missing target: {target}", "local_links")
            if url.fragment and resolved in anchors:
                check(unquote(url.fragment) in anchors[resolved], f"{rel}: missing heading anchor: {target}", "local_links")
        # Fences are parsed, not rendered; empty fences are accidental stubs.
        for token in tokens:
            if token.type == "fence":
                check(bool(token.content.strip()), f"{rel}: empty fenced block", "markdown_structure")
    return len(documents), external_count


def validate_schemas_and_fixtures(spec: dict) -> tuple[int, int]:
    schemas: dict[str, dict] = {}
    for path in sorted((ROOT / "spec").glob("*.schema.json")):
        schema = read_json(path)
        try:
            Draft202012Validator.check_schema(schema)
            check(True, "", "json_schemas")
        except Exception as error:
            check(False, f"{path.name}: {error}", "json_schemas")
        schemas[path.relative_to(ROOT).as_posix()] = schema

    resources = [(schema["$id"], Resource.from_contents(schema)) for schema in schemas.values() if "$id" in schema]
    components_resource = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:cf-agent-hub:openapi-components:1", "components": spec["components"]}
    resources.append((components_resource["$id"], Resource.from_contents(components_resource)))
    registry = Registry().with_resources(resources)

    mappings = read_json(ROOT / "validation/fixtures.json")["fixtures"]
    api_map = read_json(ROOT / "examples/http/fixture-map.json")
    operations = {operation["operationId"]: operation for path in spec["paths"].values() for method, operation in path.items() if method in {"get", "post", "patch", "put", "delete"}}
    def resolve(value):
        while isinstance(value, dict) and "$ref" in value:
            ref = value["$ref"]
            if not ref.startswith("#/"):
                raise ValueError("Only local OpenAPI fixture references are allowed")
            value = spec
            for part in ref[2:].split("/"):
                value = value[part.replace("~1", "/").replace("~0", "~")]
        return value
    for entry in api_map["fixtures"]:
        direction = entry.get("direction")
        if direction == "artifact":
            check(entry["file"] == "approval-inputs.artifact.json", "Unexpected free-standing artifact fixture mapping", "fixture_operation_mapping")
        else:
            operation = operations.get(entry.get("operation_id"))
            check(operation is not None, f"{entry['file']}: missing/unknown operation mapping", "fixture_operation_mapping")
            expected = None
            if operation and direction == "request":
                body = resolve(operation["requestBody"])
                expected = body["content"]["application/json"]["schema"].get("$ref")
            elif operation and direction == "response":
                response = resolve(operation["responses"][str(entry["http_status"])])
                expected = response["content"]["application/json"]["schema"].get("$ref")
            elif operation and direction == "query":
                expected = operation.get("x-query-fixture-schema")
            elif operation and direction == "response-headers":
                response = resolve(operation["responses"][str(entry["http_status"])])
                expected = response.get("x-header-fixture-schema")
            check(expected == entry["schema"], f"{entry['file']}: mapped schema differs from actual {direction} operation contract", "fixture_operation_mapping")
        mappings.append({"file": "examples/http/" + entry["file"], "openapi_schema": entry["schema"]})
    actual = {p.relative_to(ROOT).as_posix() for p in (ROOT / "examples").rglob("*.json") if p.name != "fixture-map.json"}
    mapped = [item["file"] for item in mappings]
    check(len(mapped) == len(set(mapped)), "Fixture map contains duplicates", "fixture_coverage")
    check(set(mapped) == actual, f"Unmapped/missing fixtures: {sorted(actual.symmetric_difference(mapped))}", "fixture_coverage")
    for entry in mappings:
        name = entry["file"]
        data = read_json(ROOT / name)
        schema = schemas[entry["schema"]] if "schema" in entry else {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "components": spec["components"],
            "$ref": entry["openapi_schema"],
        }
        errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker(), registry=registry).iter_errors(data), key=lambda e: str(e.path))
        check(not errors, f"{name}: " + "; ".join(f"{list(e.path)} {e.message}" for e in errors), "fixture_validation")
        if name.startswith("examples/profiles/"):
            for field in ["projects", "work_roles"]:
                ids = [record["id"] for record in data[field]]
                check(len(ids) == len(set(ids)), f"{name}: duplicate stable ID in {field}", "fixture_semantics")
        if name == "examples/config/deployment.example.json":
            ids = [item["workspace_id"] for item in data["workspace_catalog"]]
            objects = [item["object_name"] for item in data["workspace_catalog"]]
            check(len(ids) == len(set(ids)) and len(objects) == len(set(objects)), f"{name}: duplicate catalog identity", "fixture_semantics")
            check(all(item["workspace_id"] in ids for item in data["static_participants"]), f"{name}: foreign static participant workspace", "fixture_semantics")

    # Verify that the immutable input fixture really has the digest proposals bind.
    input_bytes = (ROOT / "examples/http/approval-inputs.artifact.json").read_bytes()
    input_digest = hashlib.sha256(input_bytes).hexdigest()
    def walk_objects(value):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from walk_objects(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk_objects(child)
    for entry in api_map["fixtures"]:
        data = read_json(ROOT / "examples/http" / entry["file"])
        for value in walk_objects(data):
            if isinstance(value.get("inputs"), dict):
                binding = value["inputs"]
                check(binding.get("artifact_id") == "artifact_inputs" and binding.get("sha256") == input_digest, f"{entry['file']}: approval inputs digest or identity differs from fixture bytes", "fixture_integrity")
            if value.get("id") == "artifact_inputs" and "byte_size" in value:
                check(value["byte_size"] == len(input_bytes) and value.get("sha256") == input_digest, f"{entry['file']}: input artifact manifest differs from bytes", "fixture_integrity")

    # These are schema rejection checks, not authorization or runtime tests.
    neutral = read_json(ROOT / "examples/profiles/neutral.json")
    profile = schemas["spec/workspace-profile.schema.json"]
    negative: list[dict] = []
    for field in ["authentication", "policy", "memberships", "credentials", "runtime_token"]:
        value = copy.deepcopy(neutral)
        value[field] = {}
        negative.append(value)
    value = copy.deepcopy(neutral)
    value["branding"]["script"] = "synthetic forbidden setting"
    negative.append(value)
    value = copy.deepcopy(neutral)
    value["contract_revision"] = "unsupported"
    negative.append(value)
    validator = Draft202012Validator(profile, format_checker=FormatChecker())
    for index, value in enumerate(negative, 1):
        check(not validator.is_valid(value), f"Profile negative case {index} unexpectedly accepted", "negative_schema_cases")
    for case in read_json(ROOT / "examples/http/r1-contract-negative.json")["cases"]:
        schema = schemas[case["schema"]]
        schema_errors = list(Draft202012Validator(schema, format_checker=FormatChecker(), registry=registry).iter_errors(case["value"]))
        semantic = deployment_semantic_errors(case["value"], case.get("context", {})) if case["schema"] == "spec/deployment-config.schema.json" else []
        paths = []
        for error in schema_errors:
            path = ".".join(str(p) for p in error.path)
            if error.validator in {"required", "additionalProperties"}:
                match = re.search(r"'([^']+)'", error.message)
                if match:
                    path += "." + match.group(1)
            paths.append(path)
        paths.extend(semantic)
        check(any(case["field"] in path for path in paths), f"R1 negative case {case['name']}: expected field {case['field']}; got {paths}", "negative_schema_cases")
    return len(schemas), len(mappings)


def safe_operator_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        if url.scheme != "https" or url.port not in (None, 443) or url.username or url.password or url.query or url.fragment or not host or "." not in host or url.geturl() != value or url.netloc != host or not url.path.startswith("/"):
            return False
        try:
            ipaddress.ip_address(host)
            return False
        except ValueError:
            pass
        return not any(host == part or host.endswith("." + part) for part in ("localhost", "local", "internal", "metadata", "home", "lan", "test"))
    except ValueError:
        return False


def deployment_semantic_errors(config: dict, context: dict) -> list[str]:
    """Cross-record rejections that JSON Schema cannot express; return field names only."""
    errors: list[str] = []
    def unique(items, key, field):
        values = [key(item) for item in items]
        if len(values) != len(set(values)):
            errors.append(field)
    catalog = config.get("workspace_catalog", [])
    workspaces = {x["workspace_id"] for x in catalog}
    unique(catalog, lambda x: x["workspace_id"], "workspace_catalog.workspace_id")
    unique(catalog, lambda x: x["object_name"], "workspace_catalog.object_name")
    grants = config.get("human_grants", [])
    unique(grants, lambda x: (x["workspace_id"], x["issuer"], x["subject"]), "human_grants.subject")
    unique(grants, lambda x: (x["workspace_id"], x["principal_id"]), "human_grants.principal_id")
    by_subject, by_principal = {}, {}
    for grant in grants:
        subject = (grant["issuer"], grant["subject"])
        principal = grant["principal_id"]
        if (subject in by_subject and by_subject[subject] != principal) or (principal in by_principal and by_principal[principal] != subject):
            errors.append("human_grants.principal_id")
        by_subject[subject] = principal
        by_principal[principal] = subject
    identity = context.get("identity")
    if identity and not any(g["workspace_id"] == identity["workspace_id"] and g["issuer"] == identity["issuer"] and g["subject"] == identity["subject"] and g["enabled"] for g in grants):
        errors.append("human_grants")
    if config.get("config_epoch", 0) <= context.get("installedEpoch", 0):
        errors.append("config_epoch")
    auth = config.get("authentication", {})
    if auth.get("client_id") != auth.get("audience"):
        errors.append("authentication.client_id")
    pins = auth.get("reviewed_oidc_endpoints", {})
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not safe_operator_url(pins.get(key, "")):
            errors.append("authentication.reviewed_oidc_endpoints." + key)
    discovery = context.get("discovery")
    if discovery and (discovery.get("issuer") != auth.get("issuer") or any(discovery.get(key) != pins.get(key) for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"))):
        errors.append("authentication.reviewed_oidc_endpoints")
    redirects = auth.get("redirect_uris", [])
    unique(redirects, lambda x: x["workspace_id"], "authentication.redirect_uris.workspace_id")
    if len(redirects) != len(catalog):
        errors.append("authentication.redirect_uris")
    for item in redirects:
        uri = urlsplit(item["redirect_uri"])
        expected = f"/v2/workspaces/{item['workspace_id']}/auth/callback"
        if item["workspace_id"] not in workspaces or uri.path != expected or uri.query or uri.fragment or not safe_operator_url(item["redirect_uri"]) or f"{uri.scheme}://{uri.netloc}" not in auth.get("allowed_origins", []):
            errors.append("authentication.redirect_uris.redirect_uri")
    participants = config.get("static_participants", [])
    participant_ids = {(x["workspace_id"], x["agent_id"]) for x in participants}
    unique(participants, lambda x: (x["workspace_id"], x["agent_id"]), "static_participants.agent_id")
    refs = config.get("static_credential_refs", [])
    unique(refs, lambda x: (x["workspace_id"], x["credential_id"]), "static_credential_refs.credential_id")
    now = datetime.fromisoformat("2026-10-23T00:00:00+00:00").timestamp()
    for item in refs:
        if (item["workspace_id"], item["agent_id"]) not in participant_ids:
            errors.append("static_credential_refs.agent_id")
        try:
            expiry = datetime.fromisoformat(item["expires_at"].replace("Z", "+00:00")).timestamp()
            if not now < expiry <= now + 90 * 86400:
                errors.append("static_credential_refs.expires_at")
        except ValueError:
            errors.append("static_credential_refs.expires_at")
    policies = config.get("workspace_policies", [])
    unique(policies, lambda x: x["workspace_id"], "workspace_policies.workspace_id")
    if len(policies) != len(catalog):
        errors.append("workspace_policies")
    for policy in policies:
        unique(policy.get("notification_destinations", []), lambda x: x["destination_id"], "workspace_policies.notification_destinations.destination_id")
        for item in policy.get("notification_destinations", []):
            if not safe_operator_url(item["url"]):
                errors.append("workspace_policies.notification_destinations.url")
            if (policy["workspace_id"], item["agent_id"]) not in participant_ids:
                errors.append("workspace_policies.notification_destinations.agent_id")
    for name, items in (("human_grants", grants), ("static_participants", participants), ("static_credential_refs", refs), ("workspace_policies", policies)):
        if any(item["workspace_id"] not in workspaces for item in items):
            errors.append(name + ".workspace_id")
    return sorted(set(errors))


def validate_api(spec: dict) -> int:
    try:
        validate_openapi(spec)
        check(True, "", "openapi_structure")
    except Exception as error:
        check(False, f"OpenAPI structural validation: {error}", "openapi_structure")
    operations: dict[str, dict] = {}
    base = "/v2/workspaces/{workspace_id}"
    unauthenticated = {
        ("post", base + "/auth/start", "startAuth", "protocol"),
        ("get", base + "/auth/callback", "callbackAuth", "protocol"),
        ("get", "/health/live", "getLiveness", "public"),
    }
    scoped_protocol = {
        ("get", base + "/auth/session", "getAuthSession"),
        ("post", base + "/auth/logout", "logoutAuth"),
    }
    observed_unauthenticated: set[tuple[str, str, str, str]] = set()
    observed_scoped_protocol: set[tuple[str, str, str]] = set()
    for path, item in spec["paths"].items():
        check(path.startswith(base) or path == "/health/live", f"Unscoped API route: {path}", "openapi_contract")
        for method, operation in item.items():
            if method not in {"get", "post", "patch", "put", "delete"}:
                continue
            name = operation["operationId"]
            check(name not in operations, f"Duplicate operationId: {name}", "openapi_contract")
            operations[name] = operation
            security = operation.get("security", spec.get("security"))
            scopes = operation.get("x-required-scopes")
            actor = operation.get("x-actor-kind")
            unauth_key = (method, path, name, actor)
            scoped_key = (method, path, name)
            if unauth_key in unauthenticated:
                observed_unauthenticated.add(unauth_key)
                check(security == [] and scopes == [], f"{name}: unauthenticated protocol/public contract changed", "openapi_contract")
            elif scoped_key in scoped_protocol:
                observed_scoped_protocol.add(scoped_key)
                check(security == [{"HumanSession": []}] and actor == "human" and scopes == [] and operation.get("x-auth-protocol") is True, f"{name}: authenticated scope-free session protocol changed", "openapi_contract")
            else:
                check(bool(security) and bool(scopes), f"Unauthenticated or unscoped domain operation: {name}", "openapi_contract")
                check(operation.get("x-auth-protocol") is not True, f"{name}: copied auth-protocol marker", "openapi_contract")
                check(actor in {"human", "agent", "both"}, f"{name}: missing domain actor lane", "openapi_contract")
    check(observed_unauthenticated == unauthenticated, "R1 unauthenticated protocol/public allowlist differs", "openapi_contract")
    check(observed_scoped_protocol == scoped_protocol, "R1 authenticated scope-free protocol allowlist differs", "openapi_contract")
    for name in ["approveApproval", "rejectApproval", "createAgent", "patchAgent", "archiveAgent", "createCredential", "revokeCredential", "listCredentials"]:
        check(operations[name]["security"] == [{"HumanSession": []}], f"{name}: human-only route permits a different actor kind", "openapi_contract")
    for name in ["claimTask", "requestTaskDecision", "submitTaskResult", "failTask", "heartbeatRun", "heartbeatRuntime"]:
        security = operations[name]["security"]
        check(bool(security) and all("NativeBearer" in option and "RuntimeProof" in option for option in security), f"{name}: native credential and runtime proof must be AND, not alternatives", "openapi_contract")
    schemas = spec["components"]["schemas"]
    states = {"backlog", "ready", "doing", "waiting", "review", "done", "cancelled"}
    check(set(schemas["TaskState"]["enum"]) == states, "TaskState differs from canonical lifecycle", "openapi_contract")
    patch = schemas["TaskPatchRequest"]
    check(patch.get("additionalProperties") is False, "Task PATCH is not closed", "openapi_contract")
    forbidden = {"state", "active_run_id", "result", "approval_id", "fence", "task_version"}
    check(not forbidden.intersection(patch["properties"]), "Task PATCH exposes server-owned state", "openapi_contract")
    for name in ["Credential", "Runtime"]:
        check(not {"token", "runtime_token", "secret"}.intersection(schemas[name]["properties"]), f"{name}: ordinary response exposes a secret", "openapi_contract")
    check("messages:review" in schemas["Scope"]["enum"], "Missing explicit message-review scope", "openapi_contract")
    return len(operations)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Write a documentation-only JSON report")
    args = parser.parse_args()
    files = sorted(p for p in ROOT.rglob("*") if p.is_file() and not any(
        part.startswith(".") or part in GENERATED_DIRECTORIES for part in p.relative_to(ROOT).parts
    ))
    json_count = 0
    for path in files:
        if path.suffix == ".json":
            try:
                read_json(path)
                check(True, "", "json_syntax")
                json_count += 1
            except Exception as error:
                check(False, f"{path.relative_to(ROOT)}: {error}", "json_syntax")
    spec = {}
    try:
        md_count, external_count = validate_markdown()
        spec = read_json(ROOT / "spec/openapi.json")
        operation_count = validate_api(spec)
        schema_count, fixture_count = validate_schemas_and_fixtures(spec)
    except Exception as error:
        ERRORS.append(f"Validation could not complete: {type(error).__name__}: {error}")
        md_count = external_count = operation_count = schema_count = fixture_count = 0
    report = {
        "package": "CF Agent Hub documentation baseline",
        "contract_revision": "r1-foundation-1",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if not ERRORS else "failed",
        "environment": {"python": platform.python_version(), **{p: importlib.metadata.version(p) for p in ["jsonschema", "openapi-spec-validator", "markdown-it-py"]}},
        "counts": {"markdown_documents": md_count, "json_files_parsed": json_count, "json_schemas": schema_count, "openapi_operations": operation_count, "openapi_component_schemas": len(spec.get("components", {}).get("schemas", {})), "mapped_fixtures": fixture_count, "external_link_occurrences_not_fetched": external_count},
        "checks": CHECKS,
        "errors": ERRORS,
        "limitations": ["No product runtime tests were run.", "No deployment, agent execution or recovery guarantee is verified by this script.", "External URLs are not fetched.", "Mermaid diagrams are parsed as fences, not rendered.", "Schema checks do not prove authorization, transaction semantics, UTF-8 byte limits or all semantic constraints.", "Public-content review and independent contract review are separate from these automated checks."],
    }
    if args.report:
        target = args.report.resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 1 if ERRORS else 0


if __name__ == "__main__":
    sys.exit(main())
