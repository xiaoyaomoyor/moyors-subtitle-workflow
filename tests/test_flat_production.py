import copy
import json
import tempfile
import unittest
from pathlib import Path

from test_msw_processing import server_module as server
from maw.msw import flat_subtitles as flat
from maw.project import normalize_project
from maw.project_io import serialize_mosp
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_export import mapped_subtitles


class FlatProductionTests(unittest.TestCase):
    def fixture(self):
        return {'segments': [dict(id='a', start=100, end=2000, text='Source')],
                'msw': {'schema': 'msw.editor.v1', 'project_id': 'production-test'}}

    def test_normal_server_upgrade_save_reopen_and_stale_writer(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'project.mosp'
            original = json.dumps(self.fixture()).encode()
            path.write_bytes(original)
            native = flat.migrate_project(self.fixture())
            backup = server.write_project_json(path, native)
            self.assertEqual(backup.read_bytes(), original)
            saved = normalize_project(json.loads(path.read_text(encoding='utf-8')))
            self.assertEqual(saved['subtitles'], native['subtitles'])
            self.assertNotIn('segments', saved)
            self.assertIn('msw.project.v4', serialize_mosp(saved))
            saved['subtitles']['cues'][0]['content']['text'] = 'Edited'
            previous = path.read_bytes()
            latest_backup = server.write_project_json(path, saved)
            self.assertEqual(latest_backup, path.with_suffix('.mosp.bak'))
            self.assertEqual(latest_backup.read_bytes(), previous)
            self.assertEqual(json.loads(path.read_text())['subtitles']['cues'][0]['content']['text'], 'Edited')
            with self.assertRaisesRegex(ValueError, '平级轨道'):
                server.write_project_json(path, normalize_project(self.fixture()))
            self.assertEqual(backup.read_bytes(), original)

    def test_attachment_compares_native_content_and_migrated_legacy(self):
        old = normalize_project(self.fixture())
        native = flat.migrate_project(old)
        self.assertTrue(server._attach_subtitles_match(old, native))
        changed = copy.deepcopy(native)
        changed['subtitles']['cues'][0]['content']['text'] = 'Different'
        self.assertFalse(server._attach_subtitles_match(native, changed))
        changed = copy.deepcopy(native)
        changed['subtitles']['tracks'][0]['name'] = 'Different'
        self.assertFalse(server._attach_subtitles_match(native, changed))

    def test_display_column_selection_does_not_change_track_style(self):
        native = flat.migrate_project(self.fixture())
        native = flat.add_track(native, {**native['subtitles']['tracks'][0], 'id': 'second', 'name': 'Second'})
        native['subtitles']['cues'].append(dict(id='b', track_id='second', content=dict(start=100, end=2000, text='Other')))
        native = flat.bind(native, native['subtitles']['cues'][0]['id'], 'b', 'pair')
        native['subtitle_view'] = {'secondary_cue_ids': ['b']}
        for target, included, excluded in [('main', 'Source', 'Other'), ('secondary', 'Other', 'Source')]:
            result = preview_ass(dict(project=native, target=target, video=dict(width=1920, height=1080)))
            self.assertIn(included, result['ass'])
            self.assertNotIn(excluded, result['ass'])
        groups = mapped_subtitles(native, {'intervals': [dict(start_ms=0, end_ms=3000, output_start_ms=0)]})
        self.assertEqual([rows[0]['text'] for _, rows in groups], ['Source', 'Other'])
