import copy
from pathlib import Path
import tempfile
import unittest

import generate_subtitle_qwen_api as asr
from maw.gui_workflow import TranscriptionRequest, build_transcribe_command
from maw.postprocess_match import processed_script_text, _match_project_with_character_timings
from maw.postprocess_pipeline import default_postprocess_plan, normalize_plan
from maw.subtitle_punctuation import custom_symbols, recognition_policy, strip_tail_text, tail_strip_symbols


class CompletePunctuationTests(unittest.TestCase):
    def tearDown(self):
        asr.configure_split_punct(None)
        asr.configure_extra_strong_punct('')

    def test_old_plan_remains_legacy_and_explicit_empty_survives_normalization(self):
        old = default_postprocess_plan()
        self.assertEqual(recognition_policy({}, old)['split_punct'], None)
        self.assertEqual(set(tail_strip_symbols(old)), set('，。,.'))
        old['steps'][0]['splitPunctuation'] = []
        result = normalize_plan(old)
        self.assertEqual(result['steps'][0]['splitPunctuation'], [])
        self.assertEqual(recognition_policy({}, result)['split_punct'], '')
        self.assertEqual(normalize_plan(result), result)

    def test_full_policy_replaces_legacy_extras_and_preservation_is_independent(self):
        plan = default_postprocess_plan()
        policy = recognition_policy({'splitPunctuationMode': 'custom', 'splitPunctuation': '！!！', 'preservePunctuation': '。！'}, plan)
        self.assertEqual(policy['split_punct'], '！!')
        self.assertEqual(strip_tail_text('Hello.', policy['strip_tail_punct']), 'Hello.')
        self.assertEqual(strip_tail_text('中间，逗号，', policy['strip_tail_punct']), '中间，逗号')
        self.assertEqual(plan, default_postprocess_plan())
        for value in ['letters', '123', '\0', ['!', 1], {'x': '!'}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                custom_symbols(value)

    def test_cjk_and_western_can_remove_period_and_comma_breaks(self):
        for mode, words in [('continuous', ['甲。', '乙，', '丙！']), ('word', ['First. ', 'Second, ', 'Third!'])]:
            items = [dict(start=i*200, end=(i+1)*200, text=text) for i, text in enumerate(words)]
            before = copy.deepcopy(items)
            asr.configure_extra_strong_punct('。，,.')
            asr.configure_split_punct('')
            result = asr.split_segments_auto(items, max_len=100, min_len=1, max_words=100, min_words=1, gap_split_ms=800, split_mode=mode)
            self.assertEqual(len(result), 1)
            asr.configure_split_punct('。，,.')
            result = asr.split_segments_auto(items, max_len=100, min_len=1, max_words=100, min_words=1, gap_split_ms=800, split_mode=mode)
            self.assertEqual(len(result), 3)
            self.assertEqual(items, before)

    def test_empty_punctuation_keeps_pause_and_length_constraints(self):
        asr.configure_split_punct('')
        words = [dict(start=i*900, end=i*900+100, text='word ') for i in range(3)]
        result = asr.split_segments_auto(words, max_len=100, min_len=1, max_words=100, min_words=1, gap_split_ms=800, split_mode='word')
        self.assertEqual(len(result), 3)

        result = asr.split_segments_auto(words, max_len=100, min_len=1, max_words=1, min_words=1, gap_split_ms=0, split_mode='word')
        self.assertEqual(len(result), 3)

    def test_custom_closing_quote_and_newline_remain_explicit_word_boundaries(self):
        for punctuation, ending in [('”', '”'), ('', '\n')]:
            asr.configure_split_punct(punctuation)
            words = [dict(start=0, end=200, text='First'+ending), dict(start=200, end=400, text='Second')]
            result = asr.split_segments_auto(words, max_len=100, min_len=1, max_words=100, min_words=1, gap_split_ms=800, split_mode='word')
            self.assertEqual(len(result), 2)

    def test_manuscript_preview_and_character_matching_use_the_complete_set(self):
        text = '甲，乙。丙！'
        self.assertEqual(processed_script_text(text, split_punctuation=(), preserve_punctuation=()), text)
        self.assertEqual(processed_script_text(text+'\n丁。', split_punctuation=()), text+'\n丁。')
        self.assertEqual(processed_script_text(text, split_punctuation=('，',), preserve_punctuation=('。',)), '甲\n乙。丙！')
        project = {'segments': [{'id': 'a', 'start': 0, 'end': 900, 'text': text,
                    'items': [dict(start=i*100, end=(i+1)*100, text=c) for i,c in enumerate(text)]}]}
        result, _ = _match_project_with_character_timings(project, text, ('，', '。'), ('！',), ())
        self.assertEqual([c['text'] for c in result['segments']], [text])

    def test_all_child_commands_preserve_explicit_empty_and_omit_legacy_flag(self):
        for provider, model, engine in [('qwen', 'qwen3-asr-flash-filetrans', ''), ('openai', 'whisper-1', ''),
                ('soniox', 'stt-async-v4', ''), ('doubao', 'bigmodel', ''), ('tencent', '', ''), ('bcut', '', ''),
                ('local', '', 'qwen3')]:
            with self.subTest(provider=provider):
                request = TranscriptionRequest(media_path=Path('synthetic.wav'), srt_path=Path('synthetic.srt'), provider=provider, model=model, engine=engine, split_punct='')
                self.assertIn('--split-punct=', build_transcribe_command(request, frozen=False))

    def test_editor_recipe_freezes_settings_and_presets_keep_empty_values(self):
        from maw.msw.asr_config import resolve_settings
        from maw.asr_presets import validate_options
        options = {'splitPunctuationMode': 'custom', 'splitPunctuation': '', 'preservePunctuation': '，。？！'}
        self.assertEqual(validate_options(options), options)
        with tempfile.TemporaryDirectory() as temp:
            result = resolve_settings(Path(temp)/'synthetic.env', {'providerId': 'qwen', 'modelId': 'qwen-audio-3.1-asr-flash-filetrans', 'apiKey': 'synthetic-key', **options}, validate_runtime=False)
            self.assertEqual(result.recipe['split_punct'], '')
            self.assertNotIn('.', result.recipe['strip_tail_punct'])
            options['splitPunctuation'] = '!'
            self.assertEqual(result.request.split_punct, '')
