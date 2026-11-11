import copy
import json
import unittest

from maw.msw.project_codec import valid_script_exports
from maw.project import normalize_project, validate_project
from maw.project_io import serialize_mosp


class ScriptExchangeTests(unittest.TestCase):
    def test_export_records_roundtrip_and_validate(self):
        record = {'id': 'script-1', 'created_at': 1, 'rows': [
            {'id': 'cue-1', 'trackId': 'track-1', 'trackName': '中文', 'number': 1,
             'start': 1000, 'end': 2000, 'text': '多行\n"Text" 😀'}]}
        project = {'segments': [], 'msw': {'schema': 'msw.editor.v1', 'project_id': 'project-1', 'script_exports': [record]}}
        self.assertTrue(validate_project(project).ok)
        self.assertEqual(json.loads(serialize_mosp(normalize_project(project)))['msw']['script_exports'], [record])
        variants = [None, {}, [record, record], [dict(record, id=1)], [dict(record, created_at=True)],
                    [dict(record, rows=record['rows'] * 2)], [dict(record, id=f'script-{i}') for i in range(6)]]
        for field, value in [('start', -1), ('number', True), ('text', 'a' * (8 * 1024 * 1024))]:
            bad = copy.deepcopy(record)
            bad['rows'][0][field] = value
            variants.append([bad])
        for records in variants:
            with self.subTest(records_type=type(records).__name__):
                self.assertFalse(valid_script_exports(records))
                project['msw']['script_exports'] = records
                self.assertFalse(validate_project(project).ok)
