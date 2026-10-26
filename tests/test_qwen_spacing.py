"""ASR sentence text, not normalized alignment tokens, owns word separators."""
from __future__ import annotations

import copy
import unittest

from generate_subtitle_qwen_api import (
    build_segments_from_api_sentences,
    parse_funasr_transcription_result,
    parse_transcription_result,
    split_coarse_segments,
    split_segments_auto,
)
from maw.language import restore_timestamp_item_text
from maw.project import normalize_project


def timed(tokens):
    return [dict(text=text, start=i * 100, end=(i + 1) * 100, speaker="2")
            for i, text in enumerate(tokens)]


class TimedTextRestorationTests(unittest.TestCase):
    def test_fragment_boundaries_do_not_define_spaces(self):
        items = timed(["You", "'", "ve", "g", "ott", "ob", "er", "eady"])
        before = copy.deepcopy(items)
        restored = restore_timestamp_item_text("You've got to be ready", items)
        self.assertEqual("".join(row['text'] for row in restored), "You've got to be ready")
        self.assertEqual([row['text'] for row in restored],
                         ["You", "'", "ve", " g", "ot t", "o b", "e r", "eady"])
        self.assertEqual(items, before)
        self.assertEqual([{k: v for k, v in row.items() if k != 'text'} for row in restored],
                         [{k: v for k, v in row.items() if k != 'text'} for row in items])

    def test_punctuation_and_unicode_spacing_come_from_sentence(self):
        cases = [
            ("Hello, world!", ["Hello", "world"]),
            ("你好，世界！", ["你", "好", "世", "界"]),
            ("hello\u00a0world\nagain", ["hello", "world", "again"]),
            ("Don't stop", ["Do", "nt", "stop"]),
            ("日本語と English words", ["日本語と", "English", "words"]),
            ("안녕 세상", ["안녕", "세상"]),
            ("a + b = 2", ["a", "+", "b", "=", "2"]),
            ("Café déjà", ["Café", "déjà"]),
            ("STRASSE gut", ["straße", "gut"]),
            ("Hello. Next!", ["Hello", ".", "Next", "!"]),
        ]
        for text, tokens in cases:
            with self.subTest(text=text):
                restored = restore_timestamp_item_text(text, timed(tokens))
                self.assertIsNotNone(restored)
                self.assertEqual("".join(row['text'] for row in restored), text)
                self.assertEqual(len(restored), len(tokens))

    def test_no_dictionary_guesses_when_reference_has_no_spaces(self):
        self.assertEqual([row['text'] for row in restore_timestamp_item_text(
            "notebook", timed(['note', 'book']))], ['note', 'book'])

    def test_zero_width_punctuation_and_already_correct_items_survive(self):
        items = timed(['Hello', '.', ' world'])
        items[1]['end'] = items[1]['start']
        self.assertEqual(restore_timestamp_item_text('Hello. world', items), items)

    def test_incomplete_or_ambiguous_tokens_are_not_rewritten(self):
        for text, tokens in [('one two three', ['one', 'three']),
                             ('one two', ['one', 'three']),
                             ('ß', ['s', 's']),
                             ('hello world', ['hello', '!', 'world'])]:
            with self.subTest(text=text, tokens=tokens):
                self.assertIsNone(restore_timestamp_item_text(text, timed(tokens)))


class QwenSpacePreservationTests(unittest.TestCase):
    def response(self, text, tokens):
        return {'transcripts': [{'text': text, 'sentences': [{
            'text': text, 'speaker_id': 2, 'begin_time': 0, 'end_time': len(tokens) * 100,
            'words': [dict(text=t, begin_time=i * 100, end_time=(i + 1) * 100)
                      for i, t in enumerate(tokens)],
        }]}]}

    def split(self, parsed, standard=False, max_words=20):
        options = dict(max_len=18, min_len=1, gap_split_ms=500,
                       max_words=max_words, min_words=1, split_mode='word')
        if not standard:
            return build_segments_from_api_sentences(parsed['sentences'], **options)
        if parsed['segments']:
            return split_coarse_segments(parsed['segments'], **options)
        return split_segments_auto(parsed['items'], **options)

    def test_both_filetrans_parsers_preserve_sentence_before_segmentation(self):
        text = "You've got to be ready"
        response = self.response(text, ["You", "'", "ve", "g", "ott", "ob", "er", "eady"])
        original = copy.deepcopy(response)
        for parser in (parse_transcription_result, parse_funasr_transcription_result):
            with self.subTest(parser=parser.__name__):
                parsed = parser(response)
                self.assertEqual(''.join(row['text'] for row in parsed['items']), text)
                segments = self.split(parsed, standard=parser is parse_transcription_result)
                self.assertEqual([row['text'] for row in segments], [text])
                self.assertEqual((segments[0]['start'], segments[0]['end']), (0, 800))
                normalize_project({'segments': segments})
                self.assertEqual(response, original)
                if parser is parse_funasr_transcription_result:
                    self.assertEqual(segments[0]['speaker'], '2')

    def test_word_limit_counts_restored_spaces(self):
        text = 'one two three four five six seven eight'
        response = self.response(text, text.split())
        for parser in (parse_transcription_result, parse_funasr_transcription_result):
            with self.subTest(parser=parser.__name__):
                segments = self.split(parser(response), parser is parse_transcription_result, max_words=3)
                self.assertGreater(len(segments), 1)
                self.assertTrue(all(len(row['text'].split()) <= 3 for row in segments))
                self.assertEqual(' '.join(row['text'].strip() for row in segments), text)

    def test_mixed_coarse_and_word_sentences_keep_repaired_items(self):
        for parser in (parse_transcription_result, parse_funasr_transcription_result):
            response = self.response('Hello world.', ['Hello', 'world.'])
            response['transcripts'][0]['text'] += ' Next sentence.'
            response['transcripts'][0]['sentences'].append(dict(
                text='Next sentence.', begin_time=1000, end_time=1800))
            with self.subTest(parser=parser.__name__):
                parsed = parser(response)
                self.assertEqual(parsed['timestamp_granularity'], 'segment')
                segments = self.split(parsed, standard=parser is parse_transcription_result)
                self.assertEqual([row['text'] for row in segments], ['Hello world.', 'Next sentence.'])
                self.assertNotIn('items', segments[1])

    def test_direct_sentence_builder_restores_spaces_too(self):
        segments = self.split({'sentences': [dict(
            text='Hello world', start=0, end=200, speaker='2', items=timed(['Hello', 'world']))]})
        self.assertEqual(segments[0]['text'], 'Hello world')

    def test_partial_tokens_preserve_whole_sentence_without_fake_word_times(self):
        response = self.response('one two three', ['one', 'three'])
        for parser in (parse_transcription_result, parse_funasr_transcription_result):
            with self.subTest(parser=parser.__name__):
                parsed = parser(response)
                self.assertEqual(parsed['timestamp_granularity'], 'segment')
                segments = self.split(parsed, standard=parser is parse_transcription_result)
                self.assertEqual(segments[0]['text'], 'one two three')
                self.assertNotIn('items', segments[0])


if __name__ == '__main__':
    unittest.main()
