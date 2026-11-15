from array import array
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

from generate_subtitle_qwen_api import build_segments_from_api_sentences, split_coarse_segments
from maw.energy_valley import snap_cue_boundaries
from maw.local_asr import LocalTranscription, build_local_segments


OPTIONS = dict(max_len=3, min_len=1, gap_split_ms=800, split_mode='continuous')


class EnergyValleyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.audio = self.root / 'synthetic.wav'

    def tearDown(self):
        self.directory.cleanup()

    def wav(self, *, quiet=(), duration=3000, channels=1, antiphase=False, silent=False, rate=16000):
        values = array('h')
        for sample in range(round(duration * rate / 1000)):
            at = sample * 1000 / rate
            value = 0 if silent or any(a <= at < b for a, b in quiet) else 10000
            values.extend([(-value if antiphase and channel % 2 and at > 1100 else value) for channel in range(channels)])
        if sys.byteorder != 'little':
            values.byteswap()
        with wave.open(str(self.audio), 'wb') as output:
            output.setparams((channels, 2, rate, 0, 'NONE', ''))
            output.writeframes(values.tobytes())

    def cues(self):
        return [dict(start=0, end=1000, text='A'), dict(start=1000, end=2000, text='B')]

    def test_obvious_valley_changes_only_the_internal_cut(self):
        self.wav(quiet=[(1180, 1220)])
        cues = self.cues(); cues[0]['speaker'] = 'SP1'
        self.assertEqual(snap_cue_boundaries(cues, self.audio, boundary_indices={1}), 1)
        self.assertEqual(cues, [dict(start=0, end=1190, text='A', speaker='SP1'), dict(start=1190, end=2000, text='B')])

    def test_flat_silence_stereo_and_outside_search_range_do_not_move(self):
        for options in ({}, {'silent':True}, {'channels':2, 'antiphase':True}, {'quiet':[(1500, 1600)]}):
            with self.subTest(options=options):
                self.wav(**options)
                cues = self.cues(); before = deepcopy(cues)
                self.assertEqual(snap_cue_boundaries(cues, self.audio, boundary_indices={1}), 0)
                self.assertEqual(cues, before)

    def test_missing_eligibility_gaps_overlap_and_reliable_items_are_untouched(self):
        self.wav(quiet=[(1180, 1220)])
        with patch('maw.energy_valley._audio_windows') as read:
            self.assertEqual(snap_cue_boundaries(self.cues(), self.audio), 0)
            read.assert_not_called()
        for change in ({'start':1010}, {'start':990}, {'items':[{'start':1000,'end':2000,'text':'B'}]}):
            cues = self.cues(); cues[1].update(change); before = deepcopy(cues)
            self.assertEqual(snap_cue_boundaries(cues, self.audio, boundary_indices={1}), 0)
            self.assertEqual(cues, before)

    def test_short_neighbours_nonzero_origin_and_sample_rounding_are_safe(self):
        for rate in (11025, 16000, 44100):
            self.wav(quiet=[(1180,1220)], rate=rate)
            cues = [dict(start=1050,end=1100), dict(start=1100,end=1300)]
            snap_cue_boundaries(cues, self.audio, boundary_indices={1})
            self.assertEqual(cues[0]['start'], 1050); self.assertEqual(cues[-1]['end'], 1300)
            self.assertEqual(cues[0]['end'], cues[1]['start'])
            self.assertGreaterEqual(cues[0]['end']-cues[0]['start'], 50)
            self.assertGreaterEqual(cues[1]['end']-cues[1]['start'], 100)
            self.assertLessEqual(abs(cues[1]['start']-1100), 400)
        tiny = [dict(start=0,end=1), dict(start=1,end=2)]
        self.assertEqual(snap_cue_boundaries(tiny, self.audio, boundary_indices={1}), 0)

    def test_two_cuts_remain_ordered_and_reads_stay_within_local_windows(self):
        reads = []
        @contextmanager
        def reader(_path):
            def energies(first, count):
                reads.append((first,count))
                return [0 if i in (65, 66) else 10 for i in range(first,first+count)]
            yield 16000, 320, 16000*3600, energies
        self.wav()
        cues = [dict(start=0,end=1000),dict(start=1000,end=1400),dict(start=1400,end=2000)]
        with patch('maw.energy_valley._audio_windows', reader):
            snap_cue_boundaries(cues, self.audio, boundary_indices={1,2})
        self.assertEqual(len(reads), 2)
        self.assertTrue(all(count <= 41 for _,count in reads))
        self.assertTrue(all(c['end']-c['start'] >= 100 for c in cues))
        self.assertEqual([cues[0]['start'], cues[-1]['end']], [0,2000])

    def test_missing_audio_dependencies_or_failed_read_preserve_original(self):
        cues = self.cues(); before = deepcopy(cues)
        self.assertEqual(snap_cue_boundaries(cues, self.audio, boundary_indices={1}), 0)
        self.audio.write_bytes(b'unsupported')
        with patch.dict(sys.modules, {'soundfile':None}):
            self.assertEqual(snap_cue_boundaries(cues, self.audio, boundary_indices={1}), 0)
        self.assertEqual(cues, before)
        @contextmanager
        def broken(_path):
            calls = 0
            def energies(first, count):
                nonlocal calls
                calls += 1
                if calls > 1: raise OSError('read failed')
                return [0 if i == 59 else 10 for i in range(first,first+count)]
            yield 16000, 320, 64000, energies
        cues.append(dict(start=2000,end=3000)); before=deepcopy(cues)
        with patch('maw.energy_valley._audio_windows',broken):
            self.assertEqual(snap_cue_boundaries(cues,self.audio,boundary_indices={1,2}),0)
        self.assertEqual(cues,before)

    def test_splitter_records_only_new_internal_cuts_not_source_edges(self):
        source = [dict(start=0,end=2000,text='甲乙丙丁戊己'), dict(start=2000,end=4000,text='庚辛壬癸子丑')]
        cuts=set(); pieces=split_coarse_segments(source, **OPTIONS, interpolated_boundary_indices=cuts)
        self.assertEqual(cuts, {1,3})
        self.assertEqual(pieces[1]['end'], 2000); self.assertEqual(pieces[2]['start'], 2000)
        self.wav(quiet=[(1180,1220),(2180,2220)],duration=4000)
        snap_cue_boundaries(pieces,self.audio,boundary_indices=cuts)
        self.assertEqual(pieces[0]['end'],1190)
        self.assertEqual(pieces[1]['end'],2000)
        for cue in pieces:
            self.assertEqual(cue['timing_precision'],'interpolated')
            self.assertNotIn('items',cue)

    def test_mixed_cloud_sentences_keep_word_timing_and_collect_coarse_fallback(self):
        sentences=[dict(start=0,end=2000,text='甲乙丙丁戊己',items=[dict(text='甲乙丙',start=0,end=1000),dict(text='丁戊己',start=1000,end=2000)]),
                   dict(start=2000,end=4000,text='庚辛壬癸子丑')]
        cuts=set(); cues=build_segments_from_api_sentences(sentences,**OPTIONS,interpolated_boundary_indices=cuts)
        self.assertEqual(cuts,{3})
        self.assertTrue(cues[0].get('items')); self.assertTrue(cues[1].get('items'))

    def test_local_pipeline_consumes_indices_before_removing_punctuation(self):
        self.wav(quiet=[(1380,1420)])
        source=[dict(start=0,end=200,text='。'),dict(start=200,end=2200,text='甲乙丙丁戊己'),dict(start=2200,end=2500,text='短句')]
        result=LocalTranscription('。甲乙丙丁戊己短句','zh',[],source,'synthetic',split_mode='continuous',timestamp_granularity='segment')
        messages=[]
        cues=build_local_segments(result,duration_ms=3000,max_len=3,min_len=1,audio_path=self.audio,on_event=messages.append)
        self.assertEqual([c['text'] for c in cues],['甲乙丙','丁戊己','短句'])
        self.assertEqual([(c['start'],c['end']) for c in cues],[(200,1390),(1390,2200),(2200,2500)])
        self.assertEqual(len(messages),1)
        self.assertEqual(source[1]['end'],2200)
