import copy
import json
import tempfile
import unittest
from pathlib import Path

from maw.config_transfer import CATEGORIES, package
from maw.config_defaults import public_recipe, public_plan, seed
from maw.user_config import UserConfig
from maw.project_subtitle_style import builtin_presets
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.project import normalize_project
from maw.msw.flat_subtitles import migrate_project


class ConfigEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def apply(self, store, raw, categories=None):
        payload = dict(package=raw, categories=categories or raw['categories'], policy='replace')
        preview = store.request(dict(action='preview', **payload))
        self.assertEqual(preview['errors'], [])
        return store.request(dict(action='import', token=preview['token'], revision=preview['revision'], **payload))

    def fixture(self):
        custom = dict(builtin_presets()[1], id='personal-large', name='Personal large')
        return package({
            'browser': {'moy.asr.editor.settings.v1': {'theme': 'light', 'mediaSeekStepMs': 2750},
                        'moy.asr.waveform.settings.v1': {'rowHeight': 240},
                        'msw.subtitle-proof.v1': {'mode': custom['id']}},
            'subtitlePresets': {'version': 1, 'presets': [custom]},
            'server': {'saved_workspaces': {'Personal': {'schema': 'moy.asr.editor.workspace.v1', 'preset': 'classic'}}},
            'launcher': {'MAW_GUI_THEME': 'dark'},
            'defaults': {'tts': {'engine': 'edge', 'edge': public_recipe('edge', {'rate': 10})},
                         'postprocess': public_plan({}), 'recovery': {'enabled': True, 'interval': 180, 'limit': 12}},
        }, list(CATEGORIES))

    def test_all_categories_transfer_into_fresh_install_and_restore(self):
        a = UserConfig(self.root / 'original' / 'user-settings.mswconfig')
        self.apply(a, self.fixture())
        exported = a.request({'action': 'export', 'categories': list(CATEGORIES)})['package']
        b = UserConfig(self.root / 'fresh' / 'user-settings.mswconfig')
        self.apply(b, json.loads(json.dumps(exported)))
        self.assertEqual(b.request({'action': 'export', 'categories': list(CATEGORIES)})['package'], exported)
        self.apply(b, package({'browser': {'mawe.language': 'en'}}, ['interface']))
        saved = b.request({'action': 'snapshots'})['snapshots'][0]
        payload = dict(id=saved['id'], categories=['interface'], policy='replace')
        preview = b.request(dict(action='restore-preview', **payload))
        b.request(dict(action='restore', **payload, revision=preview['revision'], token=preview['token']))
        self.assertEqual(b.request({'action': 'export', 'categories': list(CATEGORIES)})['package'], exported)

    def test_import_cannot_change_existing_legacy_or_flat_project_render_and_export(self):
        legacy = {'segments': [{'id': 'sample', 'start': 0, 'end': 3000, 'text': 'Sample 字幕', 'items': []}]}
        modern = migrate_project(normalize_project(legacy))
        video = dict(width=1920, height=1080)
        plan = dict(intervals=[dict(start_ms=0, end_ms=43200000, output_start_ms=0)])
        projects = [legacy, modern]
        original = copy.deepcopy(projects)
        before = [preview_ass(dict(project=p, video=video)) for p in projects]
        store = UserConfig(self.root / 'user-settings.mswconfig')
        self.apply(store, self.fixture())
        for p, snapshot in zip(projects, before):
            self.assertEqual(preview_ass(dict(project=p, video=video)), snapshot)
            normalized = p if p.get('schema') == 'msw.project.v4' else normalize_project(p)
            self.assertEqual(styled_ass(normalized, plan, 'both', video), snapshot['ass'])
        self.assertEqual(projects, original)

    def test_corrupt_retired_recipe_does_not_block_migrated_preferences(self):
        store = UserConfig(self.root / 'user-settings.mswconfig')
        recipe = public_recipe('edge', {})
        store.update(['defaults', 'tts', 'edge'], recipe)
        folder = self.root / 'edge-tts'; folder.mkdir()
        old = folder / 'settings.json'; old.write_text('broken retired config', encoding='utf-8')
        seed(store)
        exported = store.request({'action': 'export', 'categories': ['tts']})['package']
        self.assertEqual(exported['sections']['defaults']['tts']['edge'], recipe)
        self.assertEqual(old.read_text(encoding='utf-8'), 'broken retired config')
