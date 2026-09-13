"""Upgrade boundary: legacy data stays editable and peaks stay rebuildable."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from maw.project import normalize_project, ProjectValidationFailed
from maw.project_io import (INLINE_CACHE_KEYS, audio_track_conflict, persist_audio_track,
                            restore_runtime_caches, selected_audio_track_from_project,
                            serialize_mosp, strip_inline_caches)
from maw.waveform import media_signature


class Beta3ProjectTests(unittest.TestCase):
    def test_speaker_preview_contract_retains_display_and_rejects_control_characters(self):
        preview = {'x':0.1,'y':0.7,'width':0.8,'height':0.2,'color_style':'stroke',
                   'speaker_labels':{'mapping_enabled':True,'enabled':True,'names':{'red':'Alice'},'separator':': '}}
        project = normalize_project({'segments':[], 'preview':{'subtitle':preview}})
        self.assertEqual(project['preview']['subtitle']['speaker_labels']['names']['red'], 'Alice')
        for field, value in (('color_style','invalid'), ('speaker_labels',{'names':{'red':'A\nB'}})):
            broken=copy.deepcopy(preview);broken[field]=value
            with self.assertRaises(ProjectValidationFailed):
                normalize_project({'segments':[], 'preview':{'subtitle':broken}})

    def test_track_priority_and_conflict(self):
        data = {'media_metadata': {'audio_tracks': [{'audio_index': 2, 'default': True}]}}
        self.assertEqual(selected_audio_track_from_project(data), 2)
        data['waveform'] = {'audio_track': 1}
        self.assertEqual(selected_audio_track_from_project(data), 1)
        data['msw'] = {'source_audio_index': 0}
        self.assertEqual(selected_audio_track_from_project(data), 0)
        data['media_metadata']['selected_audio_track'] = 2
        self.assertEqual(selected_audio_track_from_project(data), 2)
        self.assertTrue(audio_track_conflict(data))
        self.assertEqual(persist_audio_track(data)['msw']['source_audio_index'], 0)

    def test_round_trip_legacy_upstream_empty_and_msw_assets(self):
        legacy = json.loads((Path(__file__).parent / 'fixtures/msw_beta1_legacy_project.json').read_text(encoding='utf-8'))
        variants = [legacy, {'segments': []}, {'schema': 'moy.asr.project.v1', 'segments': []},
                    {'schema': 'moy.asr.project.v1', 'segments': [], 'media_metadata': {'selected_audio_track': 1}}]
        for data in variants:
            for key in INLINE_CACHE_KEYS:
                data[key] = {'audio_track': 1, 'data': 'synthetic legacy cache'}
            before = copy.deepcopy(data)
            with patch('maw.project_io.probe_audio_tracks', return_value=None), patch('maw.project_io.probe_video_fps', return_value=None):
                saved = json.loads(serialize_mosp(normalize_project(data)))
            self.assertFalse(set(INLINE_CACHE_KEYS) & saved.keys())
            self.assertEqual(data, before)
            self.assertEqual(normalize_project(saved), saved)
            for key in ('msw', 'multi_subtitle', 'segments', 'fixture_metadata'):
                if key in data:
                    self.assertEqual(saved[key], data[key])

    def test_invalid_track_never_normalizes_to_zero(self):
        for value in (True, -1, '1', 1.5, None):
            with self.subTest(value=value), self.assertRaises(ProjectValidationFailed):
                normalize_project({'segments': [], 'media_metadata': {'selected_audio_track': value}})

    def test_save_runtime_reuse_requires_same_media_track_and_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            media = Path(directory) / 'source.wav'
            media.write_bytes(b'synthetic')
            previous = {'media': str(media), 'segments': [], 'media_metadata': {'selected_audio_track': 1}}
            for key in INLINE_CACHE_KEYS:
                previous[key] = {'audio_track': 1, 'source': media_signature(media), 'data': 'peaks'}
            disk = strip_inline_caches(previous)
            self.assertEqual(restore_runtime_caches(disk, previous, media), previous)
            for changed in ({**disk, 'media': 'another.wav'}, {**disk, 'media_metadata': {'selected_audio_track': 0}}):
                self.assertFalse(set(INLINE_CACHE_KEYS) & restore_runtime_caches(changed, previous, media).keys())
            media.write_bytes(b'changed source')
            self.assertEqual(restore_runtime_caches(disk, previous, media), disk)
