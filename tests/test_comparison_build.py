import unittest
from scripts.build_comparison_tools import ROOT, build


class ComparisonBuildTests(unittest.TestCase):
    def test_offline_pages_match_sources_and_have_no_external_script_dependencies(self):
        for name in ('compare.html', 'timestamp-compare.html'):
            with self.subTest(name=name):
                expected = build(name).encode('utf-8')
                self.assertEqual((ROOT / 'tools' / name).read_bytes(), expected)
                self.assertNotIn(b'<script src=', expected)
                self.assertNotIn(b'<!-- MSW_COMPARISON_DEPENDENCIES -->', expected)
