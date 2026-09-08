import unittest

from maw.msw.subtitle_export import burning_cues, slice_burning_cues, srt


class SubtitleExportTests(unittest.TestCase):
    def test_tracks_share_cut_and_range_mapping_with_audio(self):
        project = {'segments': [dict(start=500, end=3500, text='Main'), dict(start=0, end=4000, text='Off', disabled=True)],
                   'multi_subtitle': {'tracks': [{'segments': [dict(start=2500, end=4000, text='Second')]}]}}
        plan = {'intervals': [dict(start_ms=1000, end_ms=2000, output_start_ms=0),
                              dict(start_ms=3000, end_ms=4000, output_start_ms=1000)]}
        self.assertEqual(burning_cues(project, plan, 'both'), [
            dict(start=0, end=1000, text='Main'), dict(start=1000, end=1500, text='Main\nSecond'),
            dict(start=1500, end=2000, text='Second')])
        self.assertEqual(burning_cues(project, plan, 'secondary'), [dict(start=1000, end=2000, text='Second')])
        self.assertEqual(burning_cues(project, plan, 'none'), [])

    def test_encoder_chunk_rebases_and_escapes_caption_text(self):
        cues = [dict(start=100, end=2500, text='<b>literal</b> & text')]
        self.assertEqual(srt(slice_burning_cues(cues, 1000, 2000)),
                         '1\n00:00:00,000 --> 00:00:01,000\n&lt;b&gt;literal&lt;/b&gt; &amp; text\n')
        self.assertEqual(slice_burning_cues(cues, 2500, 3000), [])
