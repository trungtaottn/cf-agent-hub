#!/usr/bin/env python3
"""Validate plan coverage and review identity; never certify product execution."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(root: Path) -> dict:
    errors: list[str] = []
    checks = 0

    def check(condition: bool, message: str) -> None:
        nonlocal checks
        checks += 1
        if not condition:
            errors.append(message)

    register = json.loads((root / 'validation/implementation-plan-register.json').read_text())
    review = json.loads((root / 'validation/implementation-plan-review.json').read_text())
    canonical = {}
    for line in (root / 'docs/feature-matrix.md').read_text().splitlines():
        if re.match(r'\| F\d{2} \|', line):
            cells = [part.strip() for part in line.strip('|').split('|')]
            canonical[cells[0]] = {'gate': cells[2], 'status': cells[3]}
    check(len(canonical) == 42, 'Canonical feature matrix must contain exactly 42 capability IDs.')
    check(set(register['rounds']) == {'R1', 'R2', 'R3', 'R4'}, 'Register must name R1 through R4.')
    check(register['implementation_status'] == 'pending', 'Planning package must not claim implementation.')

    tasks = {}
    plan_digests = {}
    task_count = 0
    for round_id, plan in register['rounds'].items():
        path = (root / plan['path']).resolve()
        check(path.is_relative_to(root), f'{round_id}: path escapes package.')
        if not path.is_relative_to(root) or not path.is_file():
            check(False, f'{round_id}: plan file missing.')
            continue
        content = path.read_text()
        plan_digests[round_id] = hashlib.sha256(path.read_bytes()).hexdigest()
        check('Implementation pending' in '\n'.join(content.splitlines()[:6]), f'{round_id}: missing honest implementation status.')
        for section in ('**Goal:**', '**Architecture:**', '**Tech Stack:**', '**Spec:**', '## Global Constraints', '## Review Focus'):
            check(section in content, f'{round_id}: missing section {section}.')
        actual_headings = re.findall(r'^#{2,3} Task ([^:]+): (.+)$', content, flags=re.M)
        check(len(actual_headings) == len(plan['tasks']), f'{round_id}: task count differs from plan headings.')
        for task in plan['tasks']:
            task_id = task['id']
            check(task_id not in tasks, f'Duplicate task ID: {task_id}.')
            check(task['heading'] in content, f'{task_id}: registered heading not found.')
            tasks[task_id] = task
            task_count += 1
        check(len(re.findall(r'^- \[ \]', content, re.M)) >= len(plan['tasks']) * 4, f'{round_id}: insufficient checkable execution steps.')
        check(not re.search(r'^- \[[xX]\]', content, re.M), f'{round_id}: unexecuted plan contains completed checkboxes.')

    for task_id, task in tasks.items():
        for prerequisite in task['depends_on']:
            check(prerequisite in tasks, f'{task_id}: unknown dependency {prerequisite}.')
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visiting:
            check(False, f'Dependency cycle at {task_id}.')
            return
        if task_id in visited or task_id not in tasks:
            return
        visiting.add(task_id)
        for dependency in tasks[task_id]['depends_on']:
            visit(dependency)
        visiting.remove(task_id)
        visited.add(task_id)

    for task_id in tasks:
        visit(task_id)

    covered = {}
    for feature in register['feature_coverage']:
        feature_id = feature['feature_id']
        check(feature_id not in covered, f'Duplicate primary feature assignment: {feature_id}.')
        covered[feature_id] = feature
        check(feature_id in canonical, f'Unknown feature: {feature_id}.')
        if feature_id in canonical:
            check(feature['round'] == canonical[feature_id]['gate'], f'{feature_id}: release gate conflicts with baseline.')
            check(canonical[feature_id]['status'] == 'Specified', f'{feature_id}: runtime status advanced without product evidence.')
        check(bool(feature['tasks']) and all(t in tasks for t in feature['tasks']), f'{feature_id}: missing or unknown owning task.')
        check(all(t.startswith(feature['round'] + '-T') for t in feature['tasks']), f'{feature_id}: primary task belongs to another release gate.')
        check(bool(feature['acceptance'].strip()), f'{feature_id}: missing observable acceptance outcome.')
    check(set(covered) == set(canonical), 'Feature coverage does not match the canonical capability matrix.')

    check(review['scope'] == 'implementation-plans-only', 'Review must declare planning-only scope.')
    check(review['product_runtime_tests_run'] is False, 'Planning review cannot claim runtime tests.')
    check(review['open_blocking_findings'] == [], 'Planning review contains unresolved blockers.')
    check(review['reviewed_plan_sha256'] == plan_digests, 'Review identity differs from current plan bytes.')
    shared_paths = [
        'docs/superpowers/plans/2026-10-23-release-orchestration.md',
        'docs/superpowers/plans/README.md',
    ]
    shared_digests = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in shared_paths}
    check(review['reviewed_shared_sha256'] == shared_digests, 'Shared orchestration or plan index differs from reviewed bytes.')
    for finding in review['resolved_findings']:
        check(finding['status'] == 'resolved' and bool(finding['resolution'].strip()), f"Finding {finding['id']} lacks a resolution.")

    return {
        'scope': 'implementation-plans-only',
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'status': 'passed' if not errors else 'failed',
        'counts': {'rounds': len(register['rounds']), 'tasks': task_count, 'features': len(covered), 'checks': checks},
        'errors': errors,
        'limitations': [
            'Checks coverage, dependency identities, required structure and reviewed file digests.',
            'Does not execute future commands, prove design completeness or replace independent review.',
            'Does not run product tests, create a repository, deploy software or verify recovery.',
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        report = validate(ROOT)
    except (OSError, ValueError, KeyError, TypeError) as error:
        report = {'scope': 'implementation-plans-only', 'status': 'failed', 'errors': [f'{type(error).__name__}: {error}']}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
