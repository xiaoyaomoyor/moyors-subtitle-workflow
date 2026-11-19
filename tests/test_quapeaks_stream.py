"""Nonfatal decoder stderr must not discard a successful streaming waveform."""
import io
import shutil
import tempfile
import threading
import unittest
import wave
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

from maw import quapeaks


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(8000)
        writer.writeframes(b'\x00\x20\x00\xe0'*4000)
    return output.getvalue()


class StreamContractTests(unittest.TestCase):
    def invoke(self, *, code=0, warning=b'', invalid_header=False, finish_error=False, cancel_at=''):
        cancel = threading.Event()
        stream = Mock()
        stream.finish.return_value = b'synthetic-waveform'
        if finish_error:
            stream.finish.side_effect = RuntimeError('synthetic kernel failure')
        if cancel_at == 'finish':
            def finish(**_):
                cancel.set()
                return b'synthetic-waveform'
            stream.finish.side_effect = finish
        process = Mock(stdout=io.BytesIO(b'invalid' if invalid_header else wav_bytes()))
        def wait():
            if cancel_at == 'wait':
                cancel.set()
            return code
        process.wait.side_effect = wait
        process.poll.return_value = code
        def spawn(*args, **kwargs):
            kwargs['stderr'].write(warning)
            return process
        with patch.object(quapeaks, 'resolve_ffmpeg', return_value='synthetic-ffmpeg'), \
             patch.object(quapeaks, '_load_rust_kernel', return_value=Mock(ReapeaksStreamer=Mock(return_value=stream))), \
             patch.object(quapeaks.subprocess, 'Popen', side_effect=spawn), redirect_stdout(io.StringIO()) as log:
            result = quapeaks.generate_reapeaks_stream_bytes('synthetic.wav', cancel_event=cancel)
        self.assertTrue(process.stdout.closed)
        return result, stream, log.getvalue()

    def test_warning_does_not_discard_successful_stream(self):
        result, stream, log = self.invoke(warning=b'[hevc] synthetic warning')
        self.assertEqual(result, b'synthetic-waveform')
        stream.finish.assert_called_once()
        self.assertIn('解码警告', log)
        self.assertNotIn('解码失败', log)

    def test_nonzero_exit_invalid_header_and_kernel_failure_remain_failures(self):
        for case in [dict(code=1, warning=b'bad stream'), dict(invalid_header=True), dict(finish_error=True)]:
            with self.subTest(case=case):
                result, stream, log = self.invoke(**case)
                self.assertIsNone(result)
                self.assertIn('失败', log)
                if not case.get('finish_error'):
                    stream.finish.assert_not_called()

    def test_cancellation_never_returns_success_even_after_clean_process_exit(self):
        for stage in ['wait', 'finish']:
            with self.subTest(stage=stage):
                result, stream, _ = self.invoke(cancel_at=stage, warning=b'nonfatal')
                self.assertIsNone(result)
                if stage == 'wait':
                    stream.finish.assert_not_called()


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is required')
class RealStreamTests(unittest.TestCase):
    def test_real_ffmpeg_and_native_kernel_with_injected_nonfatal_stderr(self):
        self.assertIsNotNone(quapeaks._load_rust_kernel(), 'native QPK kernel is required for integration check')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'synthetic.wav'
            source.write_bytes(wav_bytes())
            real_spawn = quapeaks.subprocess.Popen
            def noisy_spawn(*args, **kwargs):
                kwargs['stderr'].write(b'synthetic nonfatal decoder diagnostic\n')
                kwargs['stderr'].flush()
                return real_spawn(*args, **kwargs)
            with patch.object(quapeaks.subprocess, 'Popen', side_effect=noisy_spawn), redirect_stdout(io.StringIO()) as log:
                result = quapeaks.generate_reapeaks_stream_bytes(source, include_spectral=False)
            self.assertTrue(result)
            output = Path(directory)/'synthetic.quapeaks'
            output.write_bytes(result)
            parsed = quapeaks.ReapeaksFile(str(output))
            self.assertTrue(parsed.is_quapeaks)
            self.assertEqual(parsed.format_version, ord('1'))
            self.assertTrue(parsed.mipmaps)
            self.assertIn('解码警告', log.getvalue())
