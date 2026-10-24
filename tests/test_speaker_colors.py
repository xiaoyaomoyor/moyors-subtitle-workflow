import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from generate_subtitle_qwen_api import main
from maw.project import validate_project
from maw.launcher_processing import native_project, apply_translation, processing_snapshot
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.project_io import serialize_mosp


class SpeakerColorGenerationTests(unittest.TestCase):
    def test_cli_cleans_empty_fragments_before_creating_color_references(self):
        # Includes a deleted head, a deleted middle member, a speaker that only
        # has punctuation, and a later return to an already seen speaker.
        sentences = [
            {'start': i * 1000, 'end': i * 1000 + 900, 'text': text, 'speaker': speaker}
            for i, (text, speaker) in enumerate([
                ('.', '0'), ('Hello.', '0'), (',', '0'), ('Again.', '0'),
                ('.', '1'), ('Next.', '2'), ('Still here.', '2'), ('Return.', '0'),
            ])
        ]
        for preserve in (False, True):
            with self.subTest(preserve=preserve), tempfile.TemporaryDirectory() as tmp:
                media = Path(tmp) / 'voices.wav'
                media.write_bytes(b'test')
                argv = ['asr', str(media), '--model', 'qwen-audio-3.0-asr-flash-filetrans',
                        '--speaker-colors', '--json', '--no-html', '-o', str(Path(tmp) / 'out.srt')]
                if preserve:
                    argv.append('--keep-punct')
                with patch('sys.argv', argv), redirect_stdout(io.StringIO()), \
                     patch('generate_subtitle_qwen_api._get_config', return_value={'qwen_audio_context_file': ''}), \
                     patch('generate_subtitle_qwen_api.resolve_default_audio_track', return_value=0), \
                     patch('generate_subtitle_qwen_api.get_duration_sec', return_value=8), \
                     patch('generate_subtitle_qwen_api.transcribe', return_value={
                         'text': 'Hello. Again. Next. Still here. Return.', 'language': 'en',
                         'sentences': copy.deepcopy(sentences), 'items': [],
                         'timestamp_granularity': 'segment'}), \
                     patch('generate_subtitle_qwen_api.write_mosp') as write:
                    main()
                project = write.call_args.args[1]
                self.assertFalse(validate_project(project).errors)
                cues = project['segments']
                self.assertEqual(len(cues), 8 if preserve else 5)
                for cue in cues:
                    head = cue if 'color' in cue else cues[cue['color_ref']['headIdx']]
                    self.assertEqual(head['speaker'], cue['speaker'])
                if not preserve:
                    self.assertEqual([(c['start'], c['end']) for c in cues],
                                     [(1000, 1900), (3000, 3900), (5000, 5900), (6000, 6900), (7000, 7900)])
                    self.assertEqual(cues[1]['color_ref']['headIdx'], 0)
                    self.assertEqual(cues[3]['color_ref']['headIdx'], 2)


class TranslatedSpeakerColorTests(unittest.TestCase):
    def test_partial_translation_materializes_color_without_copying_source_references(self):
        p = native_project({'segments': [
            {'id': 'head', 'start': 0, 'end': 900, 'text': 'Head', 'speaker': '0'},
            {'id': 'ref', 'start': 1000, 'end': 1900, 'text': 'Member', 'speaker': '0'},
        ]})
        head, ref = p['subtitles']['cues']
        head['content'].update(disabled=True, color={'name': 'green', 'value': '#66bb6a', 'start': 0, 'end': 1900})
        ref['content']['color_ref'] = {'cue_id': head['id'], 'name': 'green'}
        before = copy.deepcopy(p)
        rows = processing_snapshot(p, ref['track_id'])['segments']
        rows[0]['text'] = '译文'
        result, target = apply_translation(p, ref['track_id'], 'new', rows)
        translated = next(c for c in result['subtitles']['cues'] if c['track_id'] == target)
        self.assertEqual(translated['content'], {'start': 1000, 'end': 1900, 'text': '译文', 'speaker': '0',
            'color': {'name': 'green', 'value': '#66bb6a', 'start': 1000, 'end': 1900}})
        self.assertEqual(p, before)
        self.assertEqual(json.loads(serialize_mosp(result))['subtitles']['cues'], result['subtitles']['cues'])
        # Re-translation keeps target's deliberate markers and timing offsets.
        translated['content'].update(start=1100, speaker='custom', subtitle_style={'primaryColor': '#123456'})
        translated['content']['color'].update(name='blue', value='#61a7fa', start=1100)
        result['subtitles']['bindings'][0]['start_offset_ms'] = 100
        again, _ = apply_translation(result, ref['track_id'], target, rows)
        self.assertEqual(again['subtitles']['cues'][-1], translated)
        self.assertEqual(again['subtitles']['bindings'], result['subtitles']['bindings'])

    def test_preview_and_ass_export_apply_colors_to_both_roles_and_respect_overrides(self):
        p = native_project({'segments': [{'start': 0, 'end': 2000, 'text': 'Source', 'speaker': '0',
            'color': {'name': 'green', 'value': '#66bb6a', 'start': 0, 'end': 2000}}]})
        track = p['subtitles']['tracks'][0]['id']
        rows = processing_snapshot(p, track)['segments']
        rows[0]['text'] = 'Translation'
        p, _ = apply_translation(p, track, 'new', rows)
        video = {'width': 1920, 'height': 1080}
        plan = {'intervals': [{'start_ms': 0, 'end_ms': 2000, 'output_start_ms': 0}]}
        for mode, column in [('text', 3), ('stroke', 5), ('none', None)]:
            with self.subTest(mode=mode):
                p['preview'] = {'subtitle': {'ass_color_style': mode}}
                preview = preview_ass({'project': p, 'video': video})
                self.assertEqual(preview['ass'], styled_ass(p, plan, 'both', video))
                styles = [line.split(',') for line in preview['ass'].splitlines() if line.startswith('Style: cue-')]
                self.assertEqual(len(styles), 2)
                if column:
                    self.assertTrue(all(s[column].upper() == '&H006ABB66' for s in styles))
                else:
                    self.assertNotIn('&H006ABB66', preview['ass'].upper())
        p['preview']['subtitle']['ass_color_style'] = 'text'
        p['subtitles']['cues'][-1]['content']['subtitle_style'] = {'primaryColor': '#123456'}
        ass = preview_ass({'project': p, 'video': video})['ass']
        self.assertIn('&H00563412', ass.upper())
        self.assertIn('&H006ABB66', ass.upper())


if __name__ == '__main__':
    unittest.main()
