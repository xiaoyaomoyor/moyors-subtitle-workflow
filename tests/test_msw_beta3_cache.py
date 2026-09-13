import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from maw import mopeaks, quapeaks, waveform
from maw.output_naming import waveform_local_root

ROOT = Path(__file__).resolve().parents[1]


class CacheBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = patch.dict('os.environ', {'MSW_APP_DATA_ROOT': str(self.root / 'app')})
        self.env.start(); self.addCleanup(self.env.stop)
        self.media = self.root / 'source.wav'
        self.media.write_bytes(b'synthetic source')
        self.payload = dict(schema=waveform.WAVEFORM_SCHEMA, encoding=waveform.WAVEFORM_ENCODING,
                            data='gX8=', peak_count=1, duration_ms=10, peaks_per_second=100,
                            audio_track=0, source=waveform.media_signature(self.media))

    def test_read_only_directory_falls_back_to_source_scoped_local_binary_cache(self):
        original = tempfile.mkstemp
        def create(*args, **kwargs):
            if Path(kwargs['dir']).name == '_msw':
                raise PermissionError('synthetic read-only media folder')
            return original(*args, **kwargs)
        with patch('maw.mopeaks.tempfile.mkstemp', side_effect=create):
            cached = mopeaks.save_mopeaks(self.payload, self.media)
        self.assertEqual(cached.parent, waveform_local_root(self.media))
        self.assertEqual(mopeaks.load_mopeaks(self.media)['data'], self.payload['data'])
        other = self.root / 'other' / self.media.name
        other.parent.mkdir(); other.write_bytes(self.media.read_bytes())
        self.assertNotEqual(waveform_local_root(other), waveform_local_root(self.media))
        self.assertIsNone(mopeaks.load_mopeaks(other))

    def test_legacy_json_is_read_without_rewriting_or_deleting_it(self):
        legacy = self.root / '_maw' / 'source.waveform.json'
        legacy.parent.mkdir(); legacy.write_text(json.dumps(self.payload), encoding='utf-8')
        before = legacy.read_bytes()
        with patch('maw.waveform.extract_waveform', side_effect=AssertionError('must reuse old peaks')):
            cached, generated = waveform.load_or_extract_waveform(None, self.media)
        self.assertFalse(generated); self.assertEqual(cached, self.payload)
        self.assertEqual(legacy.read_bytes(), before)
        self.assertIsNone(mopeaks.load_mopeaks(self.media))
        self.assertIsNone(waveform.load_waveform_sidecar(self.media, audio_track=1))

    def test_legacy_json_with_media_extension_is_read_in_place(self):
        legacy = self.media.with_name(self.media.name + '.waveform.json')
        legacy.write_text(json.dumps(self.payload), encoding='utf-8')
        before = legacy.read_bytes()
        self.assertEqual(waveform.load_waveform_sidecar(self.media), self.payload)
        self.assertEqual(legacy.read_bytes(), before)

    def test_alignment_reads_mopeaks_without_scanning_and_export_strips_only_runtime_layers(self):
        spec = importlib.util.spec_from_file_location('msw_beta3_alignment', ROOT / 'server-align/serve.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module; self.addCleanup(sys.modules.pop, spec.name, None)
        spec.loader.exec_module(module)
        project = {'media': str(self.media), 'segments': [], 'custom': {'keep': True},
                   'msw': {'schema': 'msw.editor.v1', 'project_id': 'synthetic'}}
        mopeaks.save_mopeaks(self.payload, self.media)
        with patch('maw.waveform.extract_waveform', side_effect=AssertionError('alignment cannot scan')):
            module._load_waveform_cache(project, self.media)
            self.assertEqual(project['waveform']['data'], self.payload['data'])
            project['media_metadata'] = {'selected_audio_track': 1}
            module._load_waveform_cache(project, self.media)
            self.assertNotIn('waveform', project)
        project['waveform'] = self.payload
        saved = json.loads(module.write_project(self.root / 'source.mosp', project).read_text(encoding='utf-8'))
        self.assertNotIn('waveform', saved)
        self.assertEqual(saved['msw'], project['msw']); self.assertEqual(saved['custom'], project['custom'])
        self.assertIn('waveform', project)

    def test_legacy_reapeaks_import_keeps_original_class_name(self):
        from maw import reapeaks
        self.assertIs(reapeaks.ReaPeaksFile, quapeaks.ReapeaksFile)

    def test_fallback_container_cannot_relabel_a_different_sources_self_layer(self):
        derived = self.root / 'derived.wav'
        derived.write_bytes(b'synthetic derived source')
        peaks = (100, 1, b'\x81\x7f')
        for self_source in (self.media, derived):
            with self.subTest(self_source=self_source.name), \
                    patch('maw.quapeaks.generate_reapeaks_stream_bytes', side_effect=[None, b'container']) as generate, \
                    patch('maw.quapeaks._self_check', return_value=True) as check:
                result = quapeaks.generate_for_media(
                    derived, source_media_path=self.media, self_peaks=peaks,
                    self_peaks_media_path=self_source,
                )
                self.assertIsNotNone(result)
                for call in generate.call_args_list:
                    self.assertEqual(call.kwargs['self_peaks'], peaks if call.args[0] == self_source else None)
                check.assert_called_once_with(result, want_self_wave=self_source == derived)
