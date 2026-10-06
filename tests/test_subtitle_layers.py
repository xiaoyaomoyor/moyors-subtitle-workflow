from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from maw.msw.subtitle_layers import SCHEMA, migrate_project
from maw.project import normalize_project, repair_project_timing_ranges, validate_project
from maw.project_io import serialize_mosp

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/subtitle-layers.json"


class SubtitleLayersTests(unittest.TestCase):
    def test_python_browser_migrations_match_exactly(self):
        fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
        script = "const c=require('./web/msw-subtitle-layers.js');const f=require('./tests/fixtures/subtitle-layers.json');process.stdout.write(JSON.stringify(f.map(x=>c.migrate(x.project))))"
        browser = json.loads(subprocess.check_output(["node", "-e", script], cwd=ROOT, text=True, encoding="utf-8"))
        for fixture, expected in zip(fixtures, browser):
            with self.subTest(fixture=fixture["name"]):
                before = json.dumps(fixture)
                actual = migrate_project(fixture["project"])
                self.assertEqual(actual, expected)
                self.assertEqual(migrate_project(actual), actual)
                self.assertEqual(before, json.dumps(fixture))

    def test_reader_preserves_legitimate_nested_overlaps_and_repair_does_not_push_them(self):
        project = migrate_project({"segments": [
            {"id": "a", "start": 0, "end": 10000, "text": "long", "items": []},
            {"id": "b", "start": 1000, "end": 2000, "text": "short", "items": []},
            {"id": "c", "start": 1000, "end": 3000, "text": "same start", "items": []},
        ]})
        self.assertEqual(repair_project_timing_ranges(project), 0)
        normalized = normalize_project(project)
        self.assertEqual(normalized["schema"], SCHEMA)
        self.assertEqual(normalized["segments"], project["segments"])
        self.assertFalse(validate_project({**project, "schema": "moy.asr.project.v1"}).ok)

    def test_extension_overlaps_are_legal_but_malformed_ranges_are_not(self):
        source = next(f["project"] for f in json.loads(FIXTURES.read_text(encoding="utf-8")))
        project = migrate_project(source)
        project["segments"] = [{"id": "a", "start": 100, "end": 100, "text": "invalid"}]
        self.assertFalse(validate_project(project).ok)
        source = next(f["project"] for f in json.loads(FIXTURES.read_text(encoding="utf-8")) if f["name"] == "bound-bilingual")
        project = migrate_project(source)
        self.assertTrue(validate_project(project).ok, validate_project(project).errors)

    def test_reader_never_writes_original_and_writer_preserves_v2(self):
        with TemporaryDirectory() as raw:
            path = Path(raw)/"legacy.mosp"
            text = '{"segments":[{"id":"a","start":0,"end":1000,"text":"legacy"}]}'
            path.write_text(text, encoding="utf-8")
            project = migrate_project(json.loads(path.read_text(encoding="utf-8")))
            normalize_project(project)
            self.assertEqual(path.read_text(encoding="utf-8"), text)
            self.assertEqual(json.loads(serialize_mosp(project))["schema"], SCHEMA)


if __name__ == "__main__":
    unittest.main()
