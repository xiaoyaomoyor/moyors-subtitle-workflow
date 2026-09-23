"""beta.5 public project compatibility and MSW preservation."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from maw.project import normalize_project, repair_project_timing_ranges, validate_project
from maw.postprocess_io import PostprocessFileError, read_srt, render_srt, write_artifacts
from maw.launcher_queue import read_input


class UpstreamBeta5ContractTests(unittest.TestCase):
    def test_validate_project_accepts_overlay_track_overlapping_main_track(self) -> None:
        project = {
            "segments": [{"start": 0, "end": 2000, "text": "主字幕"}],
            "overlay_track": {
                "enabled": True,
                "segments": [{"start": 500, "end": 1500, "text": "叠加字幕"}],
            },
        }

        result = validate_project(project)

        self.assertTrue(result.ok, msg=str([error.to_json() for error in result.errors]))
        self.assertEqual(result.project["overlay_track"]["segments"][0]["id"], "overlay-001")

    def test_validate_project_rejects_overlay_track_internal_overlap(self) -> None:
        project = {
            "segments": [{"start": 0, "end": 2000, "text": "主字幕"}],
            "overlay_track": {
                "segments": [
                    {"start": 0, "end": 1200, "text": "第一条"},
                    {"start": 1000, "end": 1800, "text": "第二条"},
                ],
            },
        }

        result = validate_project(project)

        self.assertFalse(result.ok)
        self.assertIn(
            ("$.overlay_track.segments[1].start", "must be >= previous segment end"),
            {(error.path, error.message) for error in result.errors},
        )

    def test_validate_project_scopes_overlay_color_reference_to_overlay_track(self) -> None:
        project = {
            "segments": [{"start": 0, "end": 1000, "text": "主字幕"}],
            "overlay_track": {
                "segments": [
                    {"start": 0, "end": 1000, "text": "叠加头", "color": {"name": "red"}},
                    {
                        "start": 1000,
                        "end": 2000,
                        "text": "叠加从属",
                        "color_ref": {"name": "red", "headIdx": 0},
                    },
                ],
            },
        }

        result = validate_project(project)

        self.assertTrue(result.ok, msg=str([error.to_json() for error in result.errors]))

    def test_validate_project_accepts_current_and_legacy_color_styles(self) -> None:
        # CSS 预览 color_style：underline / text / stroke（shadow 兼容读取）；
        # ASS 的 ass_color_style：text / stroke / none。
        for color_style in ("underline", "text", "stroke", "shadow"):
            project = {
                "segments": [{"start": 0, "end": 1000, "text": "hi"}],
                "preview": {"subtitle": {
                    "x": 0.1, "y": 0.76, "width": 0.8, "height": 0.16,
                    "color_style": color_style,
                }},
            }

            result = validate_project(project)

            self.assertTrue(result.ok, color_style)
            self.assertEqual(result.project["preview"]["subtitle"]["color_style"], color_style)
        for ass_color_style in ("text", "stroke", "none"):
            project = {
                "segments": [{"start": 0, "end": 1000, "text": "hi"}],
                "preview": {"subtitle": {
                    "x": 0.1, "y": 0.76, "width": 0.8, "height": 0.16,
                    "ass_color_style": ass_color_style,
                }},
            }

            result = validate_project(project)

            self.assertTrue(result.ok, ass_color_style)
            self.assertEqual(
                result.project["preview"]["subtitle"]["ass_color_style"], ass_color_style,
            )

    def test_validate_project_rejects_invalid_ass_color_style(self) -> None:
        # ass_color_style 只接受 text / stroke / none；CSS 预览的历史值 underline
        # 不属于 ASS 语义，必须拒绝。
        project = {
            "segments": [{"start": 0, "end": 1000, "text": "hi"}],
            "preview": {"subtitle": {
                "x": 0.1, "y": 0.76, "width": 0.8, "height": 0.16,
                "ass_color_style": "underline",
            }},
        }

        result = validate_project(project)
        paths = {error.path for error in result.errors}

        self.assertIn("$.preview.subtitle.ass_color_style", paths)


class MswBeta5RoundtripTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def test_disabled_overlay_and_msw_unknown_fields_survive_derived_project(self):
        project = {
            'segments': [],
            'overlay_track': {'enabled': False, 'future': {'color': 'custom'}, 'segments': [
                {'id': '原有稳定ID', 'start': 10, 'end': 900, 'text': '副层', 'future': 42},
            ]},
            'msw': {'schema': 'msw.editor.v1', 'project_id': 'example', 'future': {'value': 7}},
            'future_project': {'keep': True},
        }
        original = copy.deepcopy(project)
        source = self.root / 'input.mosp'
        source.write_text(json.dumps(project), encoding='utf8')
        result = write_artifacts(project, source_project_path=source, source_srt_path=None,
                                 operation='proofread', write_project=True, write_srt=True)
        loaded = json.loads(result.project_path.read_text(encoding='utf8'))
        self.assertEqual(project, original)
        self.assertEqual(loaded['overlay_track'], project['overlay_track'])
        self.assertEqual(loaded['msw'], project['msw'])
        self.assertEqual(loaded['future_project'], project['future_project'])
        self.assertEqual(result.srt_path.read_text(encoding='utf-8-sig'), '')

    def test_overlay_only_export_filters_disabled_and_empty_and_numbers_contiguously(self):
        project = normalize_project({'segments': [], 'overlay_track': {'enabled': True, 'segments': [
            {'start': 0, 'end': 100, 'text': 'skip', 'disabled': True},
            {'start': 100, 'end': 200, 'text': ''},
            {'start': 200, 'end': 300, 'text': '保留'},
        ]}})
        self.assertEqual(render_srt(project), '1\n00:00:00,200 --> 00:00:00,300\n保留\n')

    def test_double_srt_roundtrip_and_strict_mode(self):
        source = self.root / 'double.srt'
        source.write_text('1\n00:00:00,000 --> 00:00:02,000\n主\n\n'
                          '2\n00:00:00,500 --> 00:00:01,500\n叠\n', encoding='utf8')
        project = read_srt(source)
        self.assertEqual(project['segments'][0]['text'], '主')
        self.assertEqual(project['overlay_track']['segments'][0]['id'], 'overlay-001')
        with self.assertRaisesRegex(PostprocessFileError, 'overlapping'):
            read_srt(source, strict=True)
        source.write_text(render_srt(project), encoding='utf8')
        self.assertEqual(read_srt(source), project)

    def test_third_layer_and_unsorted_srt_fail_without_partial_write(self):
        source = self.root / 'invalid.srt'
        for timings in [[(0, 3000), (500, 2000), (1000, 1800)], [(1000, 2000), (0, 1000)]]:
            text = render_srt({'segments': [
                {'start': start, 'end': end, 'text': str(i)} for i, (start, end) in enumerate(timings)
            ]}) if timings[0][0] == 0 else '1\n00:00:01,000 --> 00:00:02,000\na\n\n2\n00:00:00,000 --> 00:00:01,000\nb\n'
            source.write_text(text, encoding='utf8')
            with self.assertRaises(PostprocessFileError):
                read_srt(source)
            self.assertEqual(source.read_text(encoding='utf8'), text)

    def test_launcher_ass_uses_same_two_layer_contract(self):
        source = self.root / 'double.ass'
        text = '[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,0:00:00.00,0:00:02.00,主\nDialogue: 1,0:00:00.50,0:00:01.50,叠\n'
        source.write_text(text, encoding='utf8')
        project = read_input(source)
        self.assertEqual(project['overlay_track']['segments'][0]['text'], '叠')
        source.write_text(text + 'Dialogue: 2,0:00:00.60,0:00:01.00,第三层\n', encoding='utf8')
        with self.assertRaisesRegex(PostprocessFileError, 'main and overlay'):
            read_input(source)

    def test_overlay_item_repairs_and_reference_validation_are_track_local(self):
        project = {'segments': [], 'overlay_track': {'enabled': False, 'segments': [
            {'start': 100, 'end': 300, 'text': 'x', 'items': [{'start': 0, 'end': 400, 'text': 'x'}]},
        ]}}
        self.assertGreater(repair_project_timing_ranges(project), 0)
        self.assertTrue(validate_project(project).ok)
        project['overlay_track']['segments'][0]['color_ref'] = {'name': 'red', 'headIdx': 2}
        errors = validate_project(project).errors
        self.assertTrue(any(e.path.startswith('$.overlay_track.segments[0].color_ref') for e in errors))

    def test_attach_compares_frames_and_overlay_but_ignores_ms_projections(self):
        from tests.test_local_editor_server import server_editor
        original = normalize_project({'segments': [{'start': 0, 'end': 1000, 'text': 'main'}],
                                      'overlay_track': {'enabled': True, 'segments': [
                                          {'start': 50, 'end': 500, 'text': 'overlay'},
                                      ]}})
        browser = copy.deepcopy(original)
        browser['segments'][0].update(start_frame=0, end_frame=25)
        self.assertTrue(server_editor._attach_subtitles_match(original, browser))
        browser['overlay_track']['segments'][0]['text'] = 'changed'
        self.assertFalse(server_editor._attach_subtitles_match(original, browser))
        original['timebase'] = {'unit': 'frames', 'fps': 25}
        original['segments'][0].update(start_frame=0, end_frame=25)
        browser = copy.deepcopy(original)
        browser['segments'][0]['end_frame'] = 24
        self.assertFalse(server_editor._attach_subtitles_match(original, browser))

    def test_attach_accepts_only_exact_empty_bilingual_default_for_legacy_projects(self):
        from tests.test_local_editor_server import server_editor
        original = normalize_project({'segments': []})
        browser = copy.deepcopy(original)
        browser['multi_subtitle'] = {
            'schema': 'moy.asr.multi_subtitle.v1', 'enabled': False,
            'display_mode': 'both', 'tracks': [], 'bindings': [],
        }
        self.assertTrue(server_editor._attach_subtitles_match(original, browser))
        for field, value in [('enabled', True), ('tracks', [{'segments': []}]),
                             ('bindings', [{'id': 'unmatched'}]), ('extension', 'keep')]:
            changed = copy.deepcopy(browser)
            changed['multi_subtitle'][field] = value
            self.assertFalse(server_editor._attach_subtitles_match(original, changed))
