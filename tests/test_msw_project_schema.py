import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from maw.project import PROJECT_SCHEMA, ProjectValidationFailed, normalize_project, validate_project
from maw.project_io import serialize_mosp, write_mosp
from scripts import mosp_match_text


FIXTURE = Path(__file__).parent / "fixtures" / "msw_beta1_legacy_project.json"


def legacy_project():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class ProjectSchemaTests(unittest.TestCase):
    def test_legacy_normalization_and_serialization_preserve_metadata_without_mutating_input(self):
        original = legacy_project()
        before = copy.deepcopy(original)
        normalized = normalize_project(original)
        self.assertEqual(normalized["schema"], PROJECT_SCHEMA)
        self.assertEqual(normalize_project(normalized), normalized)
        for key in ("msw", "multi_subtitle", "fixture_metadata", "fixture_optional_null",
                    "language_source", "split_mode", "timestamp_granularity"):
            self.assertEqual(normalized[key], original[key], key)
        saved = json.loads(serialize_mosp(normalized))
        self.assertEqual(saved, normalized)
        self.assertEqual(original, before)
        self.assertNotIn("schema", original)

    def test_upstream_project_without_msw_remains_supported(self):
        project = {"schema": PROJECT_SCHEMA, "segments": []}
        self.assertEqual(normalize_project(project), project)
        self.assertEqual(json.loads(serialize_mosp(project)), project)

    def test_explicit_unknown_or_malformed_root_versions_are_rejected_without_mutation(self):
        for version in ("moy.asr.project.v2", "", None, False, 1, [], {}):
            with self.subTest(version=version):
                project = {**legacy_project(), "schema": version}
                before = copy.deepcopy(project)
                result = validate_project(project)
                self.assertFalse(result.ok)
                self.assertIsNone(result.project)
                self.assertIn("$.schema", [error.path for error in result.errors])
                with self.assertRaises(ProjectValidationFailed):
                    normalize_project(project)
                self.assertEqual(project, before)

    def test_both_schema_errors_are_reported_and_writer_cannot_downgrade_or_overwrite(self):
        for field in ("root", "msw", "both"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                project = legacy_project()
                if field in ("root", "both"):
                    project["schema"] = "moy.asr.project.v2"
                if field in ("msw", "both"):
                    project["msw"]["schema"] = "msw.editor.v2"
                before = copy.deepcopy(project)
                output = Path(temp) / "existing.mosp"
                output.write_bytes(b"existing project")
                with patch("maw.project_io.enrich_project_media_metadata") as enrich:
                    with self.assertRaises(ProjectValidationFailed):
                        write_mosp(output, project)
                    enrich.assert_not_called()
                self.assertEqual(output.read_bytes(), b"existing project")
                self.assertEqual(project, before)
                if field == "both":
                    paths = {error.path for error in validate_project(project).errors}
                    self.assertTrue({"$.schema", "$.msw.schema"}.issubset(paths))

    def test_standalone_matcher_accepts_legacy_and_preserves_extensions(self):
        self.assertEqual(mosp_match_text.PROJECT_SCHEMA, PROJECT_SCHEMA)
        original = legacy_project()
        _, _, text = mosp_match_text.generate_matched_mosp(json.dumps(original), "你好")
        saved = json.loads(text)
        self.assertEqual(saved["schema"], PROJECT_SCHEMA)
        for key, value in original.items():
            if key != "segments":
                self.assertEqual(saved[key], value, key)

    def test_standalone_matcher_rejects_unknown_versions_before_alignment(self):
        for field in ("root", "msw"):
            with self.subTest(field=field):
                project = legacy_project()
                if field == "root":
                    project["schema"] = "moy.asr.project.v2"
                else:
                    project["msw"]["schema"] = "msw.editor.v2"
                with self.assertRaisesRegex(mosp_match_text.AlignmentError, "不支持"):
                    mosp_match_text.generate_matched_mosp(json.dumps(project), "你好")


if __name__ == "__main__":
    unittest.main()
