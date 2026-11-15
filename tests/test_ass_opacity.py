import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from maw.ass_styles import (DEFAULT_ASS_STYLE, _normalize_style, ass_color,
                            ass_opacity_transform, ass_style_line, ass_style_force_style)
from maw.msw import cue_style, flat_subtitles as flat, subtitle_animation as animation
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.msw.track_presentation import layout
from maw.project_subtitle_style import builtin_presets, normalize_project_style
from test_subtitle_animation import model

ROOT = Path(__file__).resolve().parents[1]
VIDEO = dict(width=640, height=360)
PLAN = dict(intervals=[dict(start_ms=0, end_ms=2000, output_start_ms=0)])


def project():
    return flat.migrate_project(dict(segments=[dict(id='a', start=0, end=2000, text='ABCD')]))


class AssOpacityTests(unittest.TestCase):
    def test_legacy_defaults_and_explicit_full_opacity_are_identical(self):
        old = {k: v for k, v in DEFAULT_ASS_STYLE.items() if not k.endswith('Opacity')}
        self.assertEqual(ass_style_line(old), ass_style_line(DEFAULT_ASS_STYLE))
        self.assertEqual(ass_style_force_style(old), ass_style_force_style(DEFAULT_ASS_STYLE))
        p = project()
        before = preview_ass(dict(project=p, video=VIDEO))['ass']
        p['subtitles']['cues'][0]['content']['subtitle_style'] = dict(outlineOpacity=100, shadowOpacity=100)
        self.assertEqual(preview_ass(dict(project=p, video=VIDEO))['ass'], before)

    def test_normalization_color_rounding_and_frontend_parity(self):
        values = [None, 0, .1, 37.5, 50, 99.9, 100, -1, 101, 'invalid']
        script = """
const fs=require('fs'),vm=require('vm');const c={window:{},TextEncoder,TextDecoder,Uint8Array};
vm.runInNewContext(fs.readFileSync('web/gap-remove-core.js','utf8'),c);
vm.runInNewContext(fs.readFileSync('web/editor-utils.js','utf8'),c);const U=c.window.AsrEditorUtils;
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(v=>{
 const s=U.normalizeAssStyle({outlineOpacity:v,shadowOpacity:v,outlineColor:'#123456',backColor:'#abcdef'});
 return [s.outlineOpacity,U.assStyleLine(s)];
})));"""
        browser = json.loads(subprocess.check_output(['node', '-e', script, json.dumps(values)], cwd=ROOT, text=True))
        for value, (opacity, line) in zip(values, browser):
            with self.subTest(value=value):
                s = _normalize_style(dict(outlineOpacity=value, shadowOpacity=value, outlineColor='#123456', backColor='#abcdef'), DEFAULT_ASS_STYLE, style_id='ass')
                self.assertEqual(s['outlineOpacity'], opacity)
                # Font defaults vary by platform; the ASS color columns do not.
                self.assertEqual(ass_style_line(s).split(',')[3:7], line.split(',')[3:7])
        self.assertEqual(ass_color('#123456', opacity=50), '&H80563412')
        self.assertEqual(ass_color('#123456', opacity=0), '&HFF563412')
        self.assertIn('OutlineColour=&H80563412', ass_style_force_style(dict(outlineColor='#123456', outlineOpacity=50)))
        self.assertEqual(_normalize_style({}, dict(DEFAULT_ASS_STYLE, outlineOpacity=0), style_id='x')['outlineOpacity'], 0)

    def test_partial_validation_rejects_invalid_and_accepts_zero(self):
        for key in ('outlineOpacity', 'shadowOpacity'):
            for value in (None, True, '50', -1, 101, float('nan'), float('inf')):
                self.assertFalse(cue_style.valid({key: value}), (key, value))
            for value in (0, .1, 50, 100):
                self.assertTrue(cue_style.valid({key: value}))
        script = "const C=require('./web/msw-cue-style.js');console.log(JSON.stringify([null,true,'50',-1,101,0,.1,50,100].map(v=>C.valid({outlineOpacity:v,shadowOpacity:v}))));"
        self.assertEqual(json.loads(subprocess.check_output(['node', '-e', script], cwd=ROOT, text=True)), [False]*5+[True]*4)

    def test_project_track_speaker_cue_inheritance_reset_and_roundtrip(self):
        p = project()
        style = builtin_presets()[0]
        style['main'].update(outlineOpacity=70, shadowOpacity=80)
        p.setdefault('preview', {})['project_style'] = style
        track = p['subtitles']['tracks'][0]
        track['style'].update(mode='inherit')
        track['style'].pop('value', None)
        def opacities():
            s = layout(p)[0]['style']
            return s['outlineOpacity'], s['shadowOpacity']
        self.assertEqual(opacities(), (70, 80))
        own = copy.deepcopy(style);own['main']['outlineOpacity'] = 50
        track['style'].update(mode='snapshot', value=own)
        self.assertEqual(opacities(), (50, 80))
        cue = p['subtitles']['cues'][0]['content']
        cue['color'] = dict(name='speaker-9', start=0, end=2000)
        p['preview']['speaker_palette'] = dict(version=1, rows=[dict(id='speaker-9', name='Alice', color='#123456', mode='none', separator=' / ', style=dict(shadowOpacity=25))])
        self.assertEqual(opacities(), (50, 25))
        cue['subtitle_style'] = dict(outlineOpacity=0, shadowOpacity=10)
        self.assertEqual(opacities(), (0, 10))
        del cue['subtitle_style']['shadowOpacity']
        self.assertEqual(opacities(), (0, 25))
        flat.validate(p)
        reloaded = json.loads(json.dumps(p))
        flat.validate(reloaded)
        self.assertEqual(layout(p), layout(reloaded))
        ass = preview_ass(dict(project=p, video=VIDEO, plan=PLAN))['ass']
        self.assertEqual(ass, styled_ass(reloaded, PLAN, 'both', VIDEO))
        self.assertIn('&HFF000000,&HBF000000', ass)
        preset = normalize_project_style(own)
        self.assertEqual((preset['main']['outlineOpacity'], preset['main']['shadowOpacity']), (50, 80))

    def test_legacy_alpha_transform_composes_and_defaults_keep_literal_tags(self):
        tags = r'\fs80\alpha&H80&\3a&H40&\4a&H00&'
        self.assertEqual(ass_opacity_transform(tags, {}), tags)
        adjusted = ass_opacity_transform(tags, dict(outlineOpacity=50, shadowOpacity=0))
        self.assertEqual(adjusted, r'\fs80\1a&H80&\2a&H80&\3a&HC0&\4a&HFF&\3a&HA0&\4a&HFF&')
        p = project();s = builtin_presets()[0]
        s['main'].update(outlineOpacity=50, shadowOpacity=0)
        s['animations']['t'].update(enabled=True, tags=tags)
        p['subtitles']['tracks'][0]['style'].update(mode='snapshot', value=s)
        self.assertIn(adjusted, preview_ass(dict(project=p, video=VIDEO))['ass'])

    def test_motion_wave_typewriter_and_background_preserve_component_alpha(self):
        s = dict(builtin_presets()[0]['main'], outlineOpacity=50, shadowOpacity=0, backgroundShape='rounded', backgroundOpacity=80)
        motion = model(curves=dict(enabled=True, channels={'opacity':[dict(time=0, value=50, easing='linear')]}))
        motion['mode'] = 'custom'
        for extra in ({}, {'wave':dict(enabled=True)}, {'typewriter':dict(enabled=True)}):
            a = copy.deepcopy(motion)
            for key, value in extra.items():a['effects'][key] = dict(animation.DEFINITIONS[key], **value)
            pieces = list(animation.fragments(a, 'ABCD', s, 2000, 0, 2000, 200, 200, 2))
            self.assertTrue(pieces)
            self.assertTrue(all(r'\1a&H80&\2a&H80&\3a&HBF&\4a&HFF&' in tags for _, _, tags, _ in pieces))
            if 'wave' in extra:
                self.assertTrue(all(r'{\1a&H80&\2a&H80&\3a&HBF&\4a&HFF&\t(' in text for _, _, _, text in pieces))
            bg = list(animation.fragments(a, 'ABCD', s, 2000, 0, 2000, 200, 200, 2, drawing='m 0 0 l 20 0 20 20 0 20'))
            self.assertTrue(all(r'\alpha&H99&' in tags and r'\3a' not in tags and r'\4a' not in tags for _, _, tags, _ in bg))


class AssOpacityRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from maw.ffmpeg import resolve_ffmpeg_tools
        cls.tools = resolve_ffmpeg_tools(configured_path=os.environ.get('MSW_TEST_FFMPEG'))
        if not cls.tools.complete:raise unittest.SkipTest('FFmpeg / FFprobe unavailable')

    def render(self, outline, shadow, *, motion=None, border=1):
        p = project()
        cue = p['subtitles']['cues'][0]['content']
        cue['subtitle_style'] = dict(fontSize=180, outline=12, shadow=20, outlineColor='#ff0000', backColor='#00ff00', outlineOpacity=outline, shadowOpacity=shadow, borderStyle=border)
        if motion:cue['subtitle_animation'] = motion
        ass = styled_ass(p, PLAN, 'both', VIDEO)
        self.assertEqual(ass, preview_ass(dict(project=p, video=VIDEO, plan=PLAN))['ass'])
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'render.ass').write_text(ass, encoding='utf-8', newline='\n')
            pixels = subprocess.check_output([str(self.tools.ffmpeg), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=20:d=1', '-vf', 'ass=render.ass', '-ss', '0.5', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-threads', '1', '-'], cwd=folder)
        return tuple(sum(max(0, p[c]-max(p[(c+1)%3], p[(c+2)%3])) for p in zip(pixels[::3], pixels[1::3], pixels[2::3])) for c in (0, 1))

    def test_real_libass_independent_opacity_and_animation_multiplication(self):
        # Isolate each component: a transparent red outline otherwise exposes
        # the green shadow beneath it, changing the color-difference metric.
        full = self.render(100, 0)
        shadow = self.render(0, 100)
        self.assertGreater(min(full[0], shadow[1]), 10000)
        self.assertAlmostEqual(self.render(50, 0)[0]/full[0], .5, delta=.08)
        self.assertAlmostEqual(self.render(0, 50)[1]/shadow[1], .5, delta=.08)
        self.assertEqual(self.render(0, 0), (0, 0))
        motion = model(curves=dict(enabled=True, channels={'opacity':[dict(time=0, value=50, easing='linear')]}))
        motion['mode'] = 'custom'
        faded = self.render(50, 0, motion=motion)
        self.assertAlmostEqual(faded[0]/full[0], .25, delta=.08)
        self.assertEqual(faded[1], 0)
        motion['effects']['wave'] = dict(animation.DEFINITIONS['wave'], enabled=True)
        wave = self.render(50, 0, motion=motion)
        self.assertAlmostEqual(wave[0]/full[0], .25, delta=.1)
        self.assertEqual(wave[1], 0)

    def test_ass_box_uses_outline_opacity(self):
        full = self.render(100, 0, border=3)
        half = self.render(50, 0, border=3)
        self.assertGreater(full[0], 10000)
        self.assertAlmostEqual(half[0]/full[0], .5, delta=.08)
        self.assertEqual(self.render(0, 0, border=3), (0, 0))
