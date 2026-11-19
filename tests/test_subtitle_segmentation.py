"""Public ASR splitting keeps every original item and legal numeric boundary."""
import copy
import io
import sys
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import generate_subtitle_qwen_api as generator
from maw.subtitle_segmentation import split_long_items


def items(parts):
    return [dict(text=text, start=i*100, end=(i+1)*100, speaker='speaker-a') for i, text in enumerate(parts)]


class SubtitleSegmentationTests(unittest.TestCase):
    def setUp(self):
        self.custom = generator._CUSTOM_SPLIT_PUNCT
        self.extra = generator._EXTRA_STRONG_PUNCT
        generator.configure_split_punct(None)
        generator.configure_extra_strong_punct('')

    def tearDown(self):
        generator._CUSTOM_SPLIT_PUNCT = self.custom
        generator._EXTRA_STRONG_PUNCT = self.extra

    def split(self, original, maximum=12, **kwargs):
        before = copy.deepcopy(original)
        result = generator.split_words_to_segments(original, maximum, gap_split_ms=800, **kwargs)
        self.assertEqual([item for segment in result for item in segment['items']], before)
        self.assertEqual(original, before)
        self.assertTrue(all(s['start']==s['items'][0]['start'] and s['end']==s['items'][-1]['end'] for s in result))
        return [segment['text'] for segment in result]

    def test_rounding_to_an_item_must_not_exceed_limit_when_legal_cut_exists(self):
        self.assertEqual(self.split(items(['今天','天气真好','啊']), 5), ['今天','天气真好啊'])

    def test_numbers_units_versions_dimensions_and_latin_words_stay_whole(self):
        for expression in ['16:9','1.25倍','v1.9.0','1920×1080像素','3,000元','20 ms','APIKey']:
            with self.subTest(expression=expression):
                output = self.split(items('现在设置成'+expression+'然后继续处理画面'))
                self.assertTrue(any(expression in text for text in output), output)
                self.assertTrue(all(len(text)<=12 for text in output), output)

    def test_overlong_url_and_single_timestamp_item_are_preserved_with_notice(self):
        for original, expression in [(items('请访问https://example.org/a/v1.9?q=2继续'), 'https://example.org/a/v1.9?q=2'),
                                     (items(['这是不可拆分的原始长时间项', '然后继续']), '这是不可拆分的原始长时间项')]:
            with redirect_stdout(io.StringIO()) as log:
                output = self.split(original, 8)
            self.assertTrue(any(expression in text for text in output))
            self.assertIn('保留完整内容', log.getvalue())

    def test_short_tail_is_rebalanced_without_changing_source_or_times(self):
        text = '如果你之前已经保存过工程那么这一次就可以直接继续编辑'
        for natural in [False, True]:
            output = self.split(items(text), 12, **(dict(natural_target_len=10, natural_max_len=12) if natural else {}))
            self.assertNotEqual(output[-1], '编辑')
            self.assertTrue(all(len(part)<=12 for part in output), output)
            self.assertEqual(''.join(output), text)

    def test_custom_punctuation_cannot_split_numeric_expressions(self):
        generator.configure_split_punct('.:')
        output = self.split(items('比例16:9然后版本1.9.0继续。'), 12, min_len=1)
        for expression in ['16:9','1.9.0']:
            self.assertTrue(any(expression in part for part in output), output)
        generator.configure_split_punct('')
        self.assertEqual(self.split(items('甲。乙！丙？'), 20, min_len=1), ['甲。乙！丙？'])
        generator.configure_split_punct('！')
        self.assertEqual(self.split(items('甲。乙！丙？'), 20, min_len=1), ['甲。乙！','丙？'])

    def test_rebalancing_does_not_bridge_a_real_pause(self):
        original = items('之前已经保存过工程编辑')
        for item in original[-2:]:
            item['start'] += 800
            item['end'] += 800
        output = self.split(original, 12)
        self.assertEqual(output[-1], '编辑')

    def test_no_jieba_fallback_still_protects_numbers_and_retains_items(self):
        with patch.dict(sys.modules, {'jieba': None}):
            output = self.split(items('我们把画面比例改成16:9然后继续处理'), 12)
        self.assertTrue(any('16:9' in part for part in output))
        self.assertTrue(all(len(part)<=12 for part in output))

    def test_long_input_uses_no_recursive_splitting(self):
        original = items('这是较长的字幕内容用于验证切分。'*300)
        output = split_long_items(original, 12, set('。'))
        self.assertEqual([item for group in output for item in group], original)
        self.assertTrue(all(0<len(group)<=12 for group in output))

    def test_western_fragmented_numbers_do_not_turn_decimal_point_into_sentence_end(self):
        original = items(['The', ' ratio', ' is', ' 16', ':', '9', '.', ' Next', ' step', '.'])
        generator.configure_split_punct('.:')
        output = generator.split_words_to_segments_western(original, max_words=5, min_words=1, gap_split_ms=800)
        self.assertEqual([s['text'] for s in output], ['The ratio is 16:9.', ' Next step.'])
        self.assertEqual([i for s in output for i in s['items']], original)

    def test_western_numeric_unit_is_not_separated_by_word_limit(self):
        original = items(['Wait', ' 20', ' ms', ' then', ' go'])
        output = generator.split_words_to_segments_western(original, max_words=2, min_words=1, gap_split_ms=800)
        self.assertTrue(any('20 ms' in s['text'] for s in output))
        self.assertEqual([i for s in output for i in s['items']], original)

    def test_empty_and_invalid_limits(self):
        self.assertEqual(split_long_items([], 12, set()), [])
        with self.assertRaises(ValueError):
            split_long_items(items('甲乙'), 0, set())
