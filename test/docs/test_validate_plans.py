"""Exercise planning validation against isolated copies of actual candidate records."""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('validate_plans', ROOT / 'scripts/validate_plans.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class PlanValidationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        register = json.loads((ROOT / 'validation/implementation-plan-register.json').read_text())
        candidate = register['r1_source_candidate']
        self.amendment_path = candidate['amendment_review_path']
        amendment = json.loads((ROOT / self.amendment_path).read_text())
        paths = {
            'validation/implementation-plan-register.json',
            'validation/implementation-plan-review.json',
            'docs/feature-matrix.md',
            'docs/superpowers/plans/2026-10-23-release-orchestration.md',
            'docs/superpowers/plans/README.md',
            candidate['implementation_path'], self.amendment_path,
            *amendment['reviewed_paths'],
            *(plan['path'] for plan in register['rounds'].values()),
        }
        for references in candidate['feature_references'].values():
            paths.update(references['implementation'])
            paths.update(references['tests'])
        for relative in paths:
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, destination)

    def result(self):
        return validator.validate(self.root)

    def change_json(self, path, update):
        target = self.root / path
        value = json.loads(target.read_text())
        update(value)
        target.write_text(json.dumps(value))

    def test_honest_candidate_with_independent_amendment_passes(self):
        result = self.result()
        self.assertEqual(result['status'], 'passed', result['errors'])

    def test_tampered_plan_fails_even_with_approval_record(self):
        path = self.root / 'docs/superpowers/plans/2026-10-23-r1-foundation.md'
        path.write_text(path.read_text() + '\nUnreviewed amendment.\n')
        self.assertEqual(self.result()['status'], 'failed')

    def test_missing_amendment_fails(self):
        (self.root / self.amendment_path).unlink()
        self.assertEqual(self.result()['status'], 'failed')

    def test_invalid_amendment_cannot_extend_historical_review(self):
        path = self.root / self.amendment_path
        original = path.read_text()
        invalid = {
            'scope': 'whole-product-release', 'round': 'R2',
            'base_plan_sha256': '0' * 64, 'reviewed_plan_sha256': '0' * 64,
            'independent_review': False, 'product_runtime_tests_run': True,
            'open_blocking_findings': [{'severity': 'Important'}],
            'reviewed_at': 'not-a-date', 'summary': '', 'reviewed_paths': [],
        }
        for key, value in invalid.items():
            with self.subTest(field=key):
                path.write_text(original)
                self.change_json(self.amendment_path, lambda record: record.update({key: value}))
                self.assertEqual(self.result()['status'], 'failed')
        path.write_text(original)

    def test_verified_released_and_later_round_implementation_are_rejected(self):
        path = self.root / 'docs/feature-matrix.md'
        original = path.read_text()
        for feature, before, after in [('F01', 'Implemented', 'Verified'), ('F01', 'Implemented', 'Released'), ('F11', 'Specified', 'Implemented')]:
            with self.subTest(feature=feature, status=after):
                lines = original.splitlines()
                lines = [line.replace('| ' + before + ' |', '| ' + after + ' |') if line.startswith('| ' + feature + ' |') else line for line in lines]
                path.write_text('\n'.join(lines) + '\n')
                self.assertEqual(self.result()['status'], 'failed')
        path.write_text(original)

    def test_implemented_status_requires_existing_source_and_test(self):
        for field in ['implementation', 'tests']:
            with self.subTest(field=field):
                register_path = self.root / 'validation/implementation-plan-register.json'
                original = register_path.read_text()
                self.change_json('validation/implementation-plan-register.json', lambda record: record['r1_source_candidate']['feature_references']['F01'].update({field: ['src/missing.ts' if field == 'implementation' else 'test/missing.test.ts']}))
                self.assertEqual(self.result()['status'], 'failed')
                register_path.write_text(original)

    def test_r1_amendment_does_not_approve_changed_r2_plan(self):
        path = self.root / 'docs/superpowers/plans/2026-10-23-r2-durable-work.md'
        path.write_text(path.read_text() + '\nUnreviewed later-round change.\n')
        self.assertEqual(self.result()['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
