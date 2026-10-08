import unittest
from unittest.mock import patch

from maw.msw.subtitle_fonts import wrapped_line_count


class SubtitleLineMeasurementTests(unittest.TestCase):
    def test_wraps_words_using_advances_instead_of_character_capacity(self):
        style = dict(font_family='Test', font_size=100, width=1)
        widths = {ord('M'): .8, ord('i'): .2, ord(' '): .3}
        with patch('maw.msw.subtitle_fonts.family_metrics', return_value=widths):
            self.assertEqual(wrapped_line_count('MMMM MMMM', style, 500), 2)
            self.assertEqual(wrapped_line_count('iiii iiii', style, 500), 1)
            self.assertEqual(wrapped_line_count('iiii iiii', dict(style, scale_x=300), 500), 2)
            self.assertEqual(wrapped_line_count('iiii iiii', dict(style, spacing=50), 500), 2)
            self.assertEqual(wrapped_line_count('iiii\niiii', style, 500), 2)
            self.assertEqual(wrapped_line_count('iiii\n\niiii', style, 500), 3)

    def test_ass_unbroken_text_does_not_create_phantom_lines(self):
        style = dict(font_size=88, width=.9)
        self.assertEqual(wrapped_line_count('中文测试'*10, style, 1920), 1)
        self.assertGreater(wrapped_line_count('中文测试 '*10, style, 1920), 1)
        self.assertEqual(wrapped_line_count('', style, 1920), 1)

    def test_missing_glyph_uses_available_fallback_without_replacing_family(self):
        style = dict(font_family='Latin', bold=True, italic=True, font_size=100, width=1)
        with patch('maw.msw.subtitle_fonts.installed_fonts', return_value={'microsoft yahei': set()}), \
             patch('maw.msw.subtitle_fonts.family_metrics', side_effect=[{32: .3}, {ord('汉'): .7}]) as fonts:
            self.assertEqual(wrapped_line_count('汉汉 汉汉', style, 500), 1)
            self.assertEqual(fonts.call_args_list[0].args, ('Latin', True, True))
            self.assertEqual(fonts.call_args_list[1].args, ('microsoft yahei', True, True))
