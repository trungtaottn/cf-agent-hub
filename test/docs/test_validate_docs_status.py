"""Retained evidence status stays truthful without rewriting immutable reports."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('validate_docs', ROOT / 'scripts/validate_docs.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
STATUS = 'Status: Local synthetic source-test evidence; no release, deployment or end-to-end R3 claim.'
class StatusTests(unittest.TestCase):
    def test_exact_retained_status_and_negative_claims(self):
        for status, accepted in [(STATUS, True), ('Status: pending implementation', True), ('Status: no released runtime', True), ('Status: released and verified', False), (STATUS + ' Release approved.', False), ('Status: verified. ' + STATUS, False), (STATUS.replace('no release', 'release'), False)]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                old = validator.ROOT
                try:
                    validator.ROOT = Path(directory)
                    validator.ERRORS.clear()
                    (validator.ROOT / 'report.md').write_text('# Report\n\n' + status + '\n')
                    validator.validate_markdown()
                    self.assertEqual(not validator.ERRORS, accepted, validator.ERRORS)
                finally:
                    validator.ROOT = old
                    validator.ERRORS.clear()
    def test_retained_report_has_exact_status(self):
        self.assertEqual((ROOT / 'test/fixtures/genuine-schema18-provenance/report.md').read_text().splitlines()[2], STATUS)
