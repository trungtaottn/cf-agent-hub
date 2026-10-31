"""Synthetic controls for source-status metadata; not product/runtime evidence."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/validate_plans.py'
spec = importlib.util.spec_from_file_location('plans', SCRIPT)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
FEATURES = {f'F{n:02}' for n in range(11, 27)} | {'F29', 'F34', 'F40'}

class R2SourceStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ('docs/current.md', 'docs/feature-matrix.md', 'validation/implementation-plan-register.json',
                     'scripts/validate_plans.py', 'src/example.ts', 'test/example.ts'):
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('synthetic control only\n')
        self.candidate = {'implementation_path': 'docs/current.md',
                          'amendment_review_path': 'validation/r2-source-status-review.json',
                          'source_revision': 'a' * 40, 'source_tree': 'b' * 40,
                          'feature_references': {key: {'implementation': ['src/example.ts'],
                                                       'tests': ['test/example.ts']} for key in FEATURES}}
        self.review = {'scope': 'r2-source-status-amendment-only', 'round': 'R2',
                       'source_revision': 'a' * 40, 'source_tree': 'b' * 40,
                       'independent_review': True, 'product_runtime_tests_run': False,
                       'open_blocking_findings': [], 'reviewed_at': datetime.now(timezone.utc).isoformat(),
                       'summary': 'Synthetic source-only review control.',
                       'reviewed_paths': ['docs/current.md', 'docs/feature-matrix.md',
                                         'validation/implementation-plan-register.json', 'scripts/validate_plans.py']}

    def evaluate(self, candidate=None):
        (self.root / 'validation/r2-source-status-review.json').write_text(json.dumps(self.review))
        errors = []
        references, valid = v.validate_r2_source_candidate(self.root, self.candidate if candidate is None else candidate,
                                                          lambda ok, message: errors.append(message) if not ok else None)
        return valid, references, errors

    def test_closed_positive_metadata_only(self):
        valid, refs, errors = self.evaluate()
        self.assertTrue(valid, errors)
        self.assertEqual(set(refs), FEATURES)
        for feature in FEATURES:
            self.assertTrue(v.r2_implemented_allowed(feature, 'R2', 'Implemented', valid))

    def test_forbidden_status_round_and_feature(self):
        valid, _, _ = self.evaluate()
        for feature, release, status in [('F11', 'R2', 'Verified'), ('F11', 'R2', 'Released'),
                                          ('F11', 'R3', 'Implemented'), ('F31', 'R3', 'Implemented'),
                                          ('F36', 'R4', 'Implemented'), ('F01', 'R2', 'Implemented')]:
            self.assertFalse(v.r2_implemented_allowed(feature, release, status, valid))
        self.assertFalse(v.r2_implemented_allowed('F11', 'R2', 'Implemented', False))

    def test_missing_or_extra_feature_references_rejected(self):
        for key in ['missing', 'extra']:
            c = copy.deepcopy(self.candidate)
            if key == 'missing': del c['feature_references']['F11']
            else: c['feature_references']['F31'] = c['feature_references']['F12']
            self.assertFalse(self.evaluate(c)[0])

    def test_missing_source_or_test_file_rejected(self):
        for kind in ['implementation', 'tests']:
            c = copy.deepcopy(self.candidate)
            c['feature_references']['F11'][kind] = ['src/missing.ts' if kind == 'implementation' else 'test/missing.ts']
            self.assertFalse(self.evaluate(c)[0])

    def test_review_cannot_claim_runtime_or_wrong_identity(self):
        original = copy.deepcopy(self.review)
        for field, value in [('round', 'R3'), ('scope', 'runtime-acceptance'),
                             ('source_revision', 'c' * 40), ('source_tree', 'c' * 40),
                             ('independent_review', False), ('product_runtime_tests_run', True),
                             ('open_blocking_findings', ['unresolved']), ('reviewed_at', 'not-a-date')]:
            self.review = {**original, field: value}
            self.assertFalse(self.evaluate()[0], field)

    def test_closed_shapes_and_escape_rejected(self):
        for transform in ['extra', 'escape', 'empty', 'wrong-prefix']:
            c = copy.deepcopy(self.candidate)
            if transform == 'extra': c['permission'] = 'approve'
            if transform == 'escape': c['implementation_path'] = '../outside.md'
            if transform == 'empty': c['feature_references']['F11']['tests'] = []
            if transform == 'wrong-prefix': c['feature_references']['F11']['implementation'] = ['test/example.ts']
            self.assertFalse(self.evaluate(c)[0], transform)

if __name__ == '__main__': unittest.main()
