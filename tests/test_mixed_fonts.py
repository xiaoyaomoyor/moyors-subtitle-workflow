import copy
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

import test_selected_position as position_tests
from maw.ass_styles import _normalize_style, DEFAULT_ASS_STYLE
from maw.msw import cue_style, subtitle_animation, subtitle_gradient
from maw.msw.subtitle_fonts import _font_aliases, font_catalog, font_roots, resolve_font_family, styled_text, text_font
from maw.font_scripts import SCRIPT_FONTS
from maw.msw.track_presentation import measured_text
from maw.msw.subtitle_preview import font_manifest, preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.project_subtitle_style import builtin_presets, normalize_project_style


class MixedFontTests(unittest.TestCase):

    def test_aliases_resolve_in_ass_and_preview_manifest_without_changing_source_style(self):
        project = position_tests.SelectedPositionTests().pair()
        cue = project['subtitles']['cues'][0]['content']
        cue['text'] = 'English'
        cue['subtitle_style'] = dict(fontName='FixtureMT', latinFontName='Fixture Full')
        before = copy.deepcopy(project)
        video = dict(width=1920, height=1080)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'fixture.ttf'
            builder = FontBuilder(1000)
            builder.setupGlyphOrder(['.notdef', 'A'])
            builder.setupCharacterMap({ord('A'): 'A'})
            builder.setupGlyf({name: TTGlyphPen(None).glyph() for name in ('.notdef', 'A')})
            builder.setupHorizontalMetrics({'.notdef': (500, 0), 'A': (600, 0)})
            builder.setupHorizontalHeader(ascent=800, descent=-200)
            builder.setupNameTable({'familyName':'Fixture Family', 'styleName':'Regular'})
            builder.setupOS2()
            builder.setupPost()
            builder.save(path)
            registry = {'fixture family': {path}, 'exact family': {path}}
            catalog = [{'family': 'Fixture Family', 'aliases': ['FixtureMT', 'Fixture Full', 'Exact Family', 'Ambiguous']},
                       {'family': 'Other Family', 'aliases': ['Ambiguous']}]
            _font_aliases.cache_clear()
            resolve_font_family.cache_clear()
            self.addCleanup(_font_aliases.cache_clear)
            self.addCleanup(resolve_font_family.cache_clear)
            with patch('maw.msw.subtitle_fonts.installed_fonts', return_value=registry), \
                 patch('maw.msw.subtitle_preview.installed_fonts', return_value=registry), \
                 patch('maw.msw.subtitle_fonts.font_catalog', return_value=catalog):
                self.assertEqual(resolve_font_family('Exact Family'), 'Exact Family')
                self.assertEqual(resolve_font_family('Ambiguous'), 'Ambiguous')
                manifest = font_manifest(['FixtureMT','Fixture Full','Unknown'])
                self.assertEqual(manifest['missing'], ['Unknown'])
                self.assertEqual(len(manifest['fonts']), 1)
                ass = preview_ass(dict(project=project, video=video))['ass']
                self.assertIn(',Fixture Family,', ass)
                self.assertNotIn('FixtureMT', ass)
                self.assertNotIn('Fixture Full', ass)
        self.assertEqual(project, before)

    def test_macos_only_reads_designated_mobile_asset_font_roots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            fonts = root / 'com_apple_MobileAsset_Font7'
            others = root / 'com_apple_MobileAsset_Example'
            fonts.mkdir()
            others.mkdir()
            with patch('maw.msw.subtitle_fonts.sys.platform', 'darwin'), \
                 patch('maw.msw.subtitle_fonts.MACOS_FONT_ASSETS', root):
                self.assertIn(fonts, font_roots())
                self.assertNotIn(others, font_roots())
    def test_script_fonts_roundtrip_and_ass_keep_all_categories(self):
        samples = ['éA', 'かな', '한글', 'Жя', 'Ωα', 'سلام', 'שלום', 'नमस्ते', 'ไทย']
        style = dict(fontName='Han', **{key:key for key in SCRIPT_FONTS})
        normalized = _normalize_style(style, DEFAULT_ASS_STYLE, style_id='main')
        self.assertTrue(cue_style.valid({k:style[k] for k in SCRIPT_FONTS}))
        for key, text in zip(SCRIPT_FONTS, samples):
            self.assertEqual(normalized[key], key)
            self.assertEqual(text_font(text, style), key)
            self.assertIn(r'{\fn' + key + '}', styled_text('漢'+text, style))
            self.assertFalse(cue_style.valid({key: r'unsafe\pos(0,0)'}))
        self.assertEqual(text_font('漢', style), 'Han')
        self.assertEqual(text_font('1', style), 'latinFontName')
        self.assertEqual(text_font('한', {'fontName':'Fallback'}), 'Fallback')

    def test_catalog_localizes_deduplicates_and_checks_real_glyph_coverage(self):
        def record(name, lang, value):
            r = MagicMock(nameID=name, langID=lang)
            r.toUnicode.return_value = value
            return r
        font = MagicMock()
        font.__getitem__.return_value.names = [record(16, 0x409, 'Test CJK'), record(16, 0x804, '测试字体'), record(4, 0x409, 'Test CJK Bold')]
        font.getBestCmap.return_value = dict.fromkeys([*range(0x4e00, 0x4f00), *map(ord, '中文天地人山水日月一二三ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')], 'glyph')
        owner = MagicMock(fonts=[font, font])
        font_catalog.cache_clear()
        with patch('maw.msw.subtitle_fonts.installed_fonts', return_value={'test cjk': {Path('fixture.ttc')}}), patch('fontTools.ttLib.TTCollection', return_value=owner):
            catalog = font_catalog()
        font_catalog.cache_clear()
        self.assertEqual(len(catalog), 1)
        self.assertEqual(catalog[0]['family'], 'Test CJK')
        self.assertEqual(catalog[0]['label'], '测试字体')
        self.assertTrue(catalog[0]['cjk'])
        self.assertTrue(catalog[0]['latin'])
        self.assertIn('han', catalog[0]['scripts'])
        self.assertNotIn('kana', catalog[0]['scripts'])
        self.assertNotIn('fixture', json.dumps(catalog))
        owner.close.assert_called_once()

    def test_chinese_label_does_not_make_latin_only_face_a_chinese_font(self):
        def record(name, value):
            r = MagicMock(nameID=name, langID=0x409)
            r.toUnicode.return_value = value
            return r
        font = MagicMock()
        font.__getitem__.return_value.names = [record(1, 'Test Black'), record(16, 'Test'), record(4, '中文名称')]
        font.getBestCmap.return_value = dict.fromkeys(map(ord, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'), 'glyph')
        owner = MagicMock(fonts=[font])
        font_catalog.cache_clear()
        with patch('maw.msw.subtitle_fonts.installed_fonts', return_value={'test': {Path('fixture.ttc')}}), patch('fontTools.ttLib.TTCollection', return_value=owner):
            catalog = font_catalog()
        font_catalog.cache_clear()
        self.assertEqual(catalog[0]['family'], 'Test Black')
        self.assertTrue(catalog[0]['latin'])
        self.assertFalse(catalog[0]['cjk'])

    def test_optional_english_face_survives_style_and_cue_normalization(self):
        raw = builtin_presets()[0]
        raw['main']['latinFontName'] = 'Georgia'
        self.assertEqual(normalize_project_style(raw)['main']['latinFontName'], 'Georgia')
        self.assertNotIn('latinFontName', _normalize_style({}, DEFAULT_ASS_STYLE, style_id='main'))
        self.assertTrue(cue_style.valid({'latinFontName': ''}))
        self.assertTrue(cue_style.valid({'latinFontName': 'Georgia'}))
        self.assertFalse(cue_style.valid({'latinFontName': r'Georgia\pos(0,0)'}))

    def test_mixed_runs_preserve_escaping_and_old_style_text(self):
        style = dict(fontName='中文字体', latinFontName='Georgia')
        text = '中文 English 123，继续\n测试'
        result = styled_text(text, style)
        self.assertIn(r'{\fnGeorgia} English 123{\fn中文字体}，继续', result)
        self.assertIn(r'\N', result)
        self.assertEqual(styled_text('中文 text', dict(fontName='Same')), '中文 text')
        self.assertNotIn(r'{\pos', styled_text(r'{\pos(0,0)}', style))

    def test_wrapping_uses_each_scripts_actual_advances(self):
        style = dict(builtin_presets()[0]['main'], fontName='Chinese', latinFontName='English', fontSize=100,
                     marginL=0, marginR=0, outline=0, shadow=0)
        tables = {'Chinese': {ord(c): .8 for c in '中AB'}, 'English': {ord('A'): .2, ord('B'): .2}}
        with patch('maw.msw.track_presentation.installed_fonts', return_value={}), patch('maw.msw.track_presentation.family_metrics', side_effect=lambda name,*a: tables[name]):
            mixed = measured_text('中AB', style, 130)
            single = measured_text('中AB', {**style, 'latinFontName': ''}, 130)
        self.assertEqual(mixed['text'], '中AB')
        self.assertGreater(single['text'].count('\n'), 0)
        self.assertAlmostEqual(mixed['textWidth'], 120)

    def test_preview_export_gradient_typewriter_and_reload_share_fonts(self):
        project = position_tests.SelectedPositionTests().pair()
        cue = project['subtitles']['cues'][0]['content']
        cue['text'] = '中文 English 123'
        cue['subtitle_style'] = dict(fontName='Microsoft YaHei', latinFontName='Georgia')
        before = copy.deepcopy(project)
        plan = dict(intervals=[dict(start_ms=0, end_ms=43200000, output_start_ms=0)])
        video = dict(width=1920, height=1080)
        for animated in (False, True):
            if animated:
                cue['subtitle_style'].update(gradientMode='characters')
                cue['subtitle_animation'] = subtitle_animation.normalize({'schema': subtitle_animation.SCHEMA, 'effects': {'typewriter': {**subtitle_animation.DEFINITIONS['typewriter'], 'enabled': True}}})
            ass = preview_ass(dict(project=project, video=video))['ass']
            self.assertIn(r'\fnGeorgia', ass)
            self.assertEqual(ass, styled_ass(project, plan, 'both', video))
            self.assertEqual(ass, preview_ass(dict(project=json.loads(json.dumps(project)), video=video))['ass'])
        self.assertEqual(project['subtitles']['bindings'], before['subtitles']['bindings'])
        self.assertEqual(project['subtitles']['cues'][1:], before['subtitles']['cues'][1:])
        self.assertIn(r'\fnGeorgia', subtitle_gradient.ass('中文字ABC', cue['subtitle_style']))
