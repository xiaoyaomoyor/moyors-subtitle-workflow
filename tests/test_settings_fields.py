import copy
import json
import tempfile
import unittest
from pathlib import Path

from maw.settings_fields import EDITOR_KEY as E, WAVEFORM_KEY as W, FIELDS, migrate_sections
from maw.user_config import UserConfig, validate
from maw.config_transfer import package, parse, prepare


def empty():
    return dict(format='msw-config', version=1, revision=0, sections={}, migrations=[])


class SettingsFieldsTests(unittest.TestCase):
    def test_migration_modern_values_win_and_input_is_untouched(self):
        original = {'browser': {E: {'splitAutoSubmit': True, 'mergeJoinText': ' / ',
            'mergeJoinTextWord': ' ', 'mediaSeekStepSeconds': 2.5, 'mediaSeekStepMs': 500,
            'multiSubtitleRowHeight': 168}, W: {'rowHeight': 240, 'showGroupBadges': False}}}
        before = copy.deepcopy(original)
        result = migrate_sections(original)
        self.assertEqual(original, before)
        self.assertEqual(result['browser'][E], {'mergeJoinTextContinuous': ' / ', 'mergeJoinTextWord': ' ',
            'mediaSeekStepMs': 500, 'multiSubtitleRowHeight': 168, 'flatTrackSettingsMigrated': True})
        self.assertEqual(result['browser'][W], {'rowHeight': 240, 'showTrackHeads': False})
        self.assertEqual(migrate_sections(result), result)

    def test_snapshot_atomically_migrates_existing_store_once(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'user-settings.mswconfig'
            old = empty()
            old['sections'] = {'browser': {E: {'mediaSeekStepSeconds': 1.25, 'splitAutoSubmit': True,
                'multiSubtitleRowHeight': 168, 'subtitleColorPalette': {'1': '#00ff00'}}}}
            path.write_text(json.dumps(old), encoding='utf-8')
            store = UserConfig(path)
            result = store.snapshot()
            self.assertEqual(result['sections']['browser'][E]['mediaSeekStepMs'], 1250)
            self.assertEqual(result['sections']['browser'][W]['rowHeight'], 168)
            self.assertEqual(json.loads(path.with_suffix('.mswconfig.bak').read_text()), old)
            self.assertEqual(store.snapshot()['revision'], result['revision'])
            self.assertEqual(result['registry'][E]['fields'], FIELDS[E])
            store.update(['browser', E, 'theme'], 'light')
            backups = list((path.parent / 'config-migration-backups').glob('fields-v1-*.mswconfig'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(json.loads(backups[0].read_text()), old)

    def test_public_export_excludes_migration_flags_legacy_inputs_and_session_state(self):
        data = {'browser': {E: {'theme':'dark', 'flatTrackSettingsMigrated':True,
            'subtitleColorPaletteEnabled':True, 'subtitleColorPalette':{'1':'#00ff00'},
            'splitAutoSubmit':True, 'mergeJoinText':'~'}, W: {'rowHeight':168,'layoutEditing':True}}}
        exported = package(data, ['interface','waveform'])
        self.assertEqual(exported['sections']['browser'][E], {'theme':'dark','mergeJoinTextContinuous':'~','mergeJoinTextWord':'~'})
        self.assertEqual(exported['sections']['browser'][W], {'rowHeight':168})
        before = empty();before['sections'] = data
        incoming = package({'browser':{E:{'theme':'light'}}}, ['interface'])
        after, _ = prepare(before, incoming, ['interface'], 'replace')
        self.assertEqual(after['browser'][E], {'theme':'light',
            'flatTrackSettingsMigrated':True,'subtitleColorPaletteEnabled':True,'subtitleColorPalette':{'1':'#00ff00'}})
        self.assertEqual(after['browser'][W], data['browser'][W])

    def test_legacy_import_migrates_before_filtering_and_rejects_project_in_preferences(self):
        raw = {'format':'msw-config','version':1,'kind':'preferences','categories':['interface','waveform'],
            'sections':{'browser':{E:{'mediaSeekStepSeconds':2,'splitAutoSubmit':False,
                'cueListAutoScrollOnClick':True,'cueListKeepSplitVisible':False},W:{'showGroupBadges':False}}}}
        self.assertEqual(parse(raw)['sections'], {'browser':{E:{'mediaSeekStepMs':2000},W:{'showTrackHeads':False}}})
        for field in ('preview','subtitles','workspace','speaker_palette'):
            with self.assertRaisesRegex(ValueError,'工程'):
                validate({'browser':{E:{field:{}}}})
        raw['sections']['browser'][E] = {'unknown_option':True}
        with self.assertRaisesRegex(ValueError,'未登记'):
            parse(raw)

    def test_invalid_legacy_value_does_not_replace_a_valid_default(self):
        for value in (None, False, '', 'not-a-time'):
            result=migrate_sections({'browser':{E:{'mediaSeekStepSeconds':value}}})
            self.assertNotIn('mediaSeekStepMs',result['browser'][E])


if __name__ == '__main__':
    unittest.main()
