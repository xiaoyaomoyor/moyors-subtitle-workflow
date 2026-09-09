"""Deterministic local Gradio fixture; never loads a model or connects to a cloud."""

import io
import json
import threading
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from maw.msw.index_tts import DEFAULT_RECIPE


def wav_bytes():
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as writer:
        writer.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        writer.writeframes(b'\0\0' * 2205)
    return stream.getvalue()


class IndexFixture:
    def __init__(self, *, text_emotion=True):
        self.modes = ['Follow reference', 'Emotion audio', 'Emotion vector', 'Emotion text'][:4 if text_emotion else 3]
        self.audio = wav_bytes()
        self.calls, self.uploads, self.cancels = [], [], []
        self.events = {}
        self.block = False
        self.bad_audio = False
        self.failed = False
        self.preset_warning = False
        self.entered = threading.Event()
        self.release = threading.Event()
        self.samples = [['voice_01.wav', self.modes[0], 'Example text must not replace subtitles', '', .65, '', *([0] * 8), 'ZH'],
                        ['voice_01.wav', self.modes[1], 'Another example', 'emotion.wav', .65, '', *([0] * 8), 'EN']]
        self.names = ['on_example_click', 'on_experimental_change', 'refresh_preset_choices', 'on_preset_load', 'gen_single']
        self.parameters = ['emo_control_method', 'prompt', 'text', 'lang_choice', 'emo_ref_path', 'emo_weight',
                           *[f'vec{i}' for i in range(1, 9)], 'emo_text', 'emo_random', 'max_text_tokens_per_segment',
                           'duration_factor', *[f'param_{i}' for i in range(18, 26)]]
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def send(self, value, mime='application/json'):
                body = value if isinstance(value, bytes) else json.dumps(value).encode()
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                url = urlsplit(self.path)
                if url.path == '/config':
                    props = [{} for _ in range(26)]
                    props[0] = {'choices': [[m, m] for m in owner.modes[:3]]}
                    props[3] = {'choices': [[lang, lang] for lang in ['ZH', 'EN', 'JA', 'AR', 'ES']]}
                    props[16], props[25] = {'maximum': 600}, {'maximum': 1815}
                    self.send({'api_prefix': '/gradio_api', 'version': '5.45.0',
                               'components': [{'id': i, 'props': p} for i, p in enumerate(props)],
                               'dependencies': [{'id': i + 10, 'api_name': name, 'inputs': list(range(26)) if name == 'gen_single' else []}
                                                for i, name in enumerate(owner.names)]})
                elif url.path == '/gradio_api/info':
                    self.send({'named_endpoints': {'/gen_single': {'parameters': [{'parameter_name': p} for p in owner.parameters]}}})
                elif url.path.startswith('/gradio_api/file='):
                    self.send(b'broken' if owner.bad_audio else owner.audio, 'audio/wav')
                elif url.path == '/gradio_api/queue/data':
                    key = parse_qs(url.query)['session_hash'][0]
                    event, name, data = owner.events[key]
                    if name == 'gen_single':
                        owner.entered.set()
                        if owner.block:
                            owner.release.wait(5)
                    result = owner.result(name, data)
                    message = {'msg': 'process_completed', 'event_id': event, 'success': not owner.failed,
                               'output': {'data': result, 'error': 'private traceback should not be exposed'}}
                    warning = {'msg': 'log', 'event_id': event, 'level': 'warning', 'log': 'Model missing; reset preset to default'}
                    prefix = ('data: ' + json.dumps(warning) + '\n\n') if name == 'on_preset_load' and owner.preset_warning else ''
                    self.send((prefix + 'data: ' + json.dumps(message) + '\n\n').encode(), 'text/event-stream')
                else:
                    self.send_error(404)

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                if self.path == '/gradio_api/upload':
                    owner.uploads.append(raw)
                    self.send(['/server-cache/reference.wav'])
                    return
                data = json.loads(raw)
                if self.path == '/gradio_api/queue/join':
                    name = owner.names[data['fn_index'] - 10]
                    owner.calls.append((name, data))
                    event = uuid.uuid4().hex
                    owner.events[data['session_hash']] = (event, name, data['data'])
                    self.send({'event_id': event})
                elif self.path == '/gradio_api/cancel':
                    owner.cancels.append(data)
                    owner.release.set()
                    self.send({'success': True})
                else:
                    self.send_error(404)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def result(self, name, data):
        audio = {'path': '/server-cache/example.wav', 'url': self.url + '/gradio_api/file=example.wav', 'meta': {'_type': 'gradio.FileData'}}
        if name == 'on_experimental_change':
            return [{'choices': [[m, m] for m in self.modes]}, {'samples': self.samples}]
        if name == 'refresh_preset_choices':
            return [{'choices': [['', ''], ['Fixture preset', 'Fixture preset']]}] * 2
        if name == 'on_example_click':
            row = self.samples[data[0]].copy()
            row[0] = {'__type__': 'update', 'value': audio}
            row[3] = {'__type__': 'update', 'value': audio if row[3] else None}
            return row
        if name == 'on_preset_load':
            return [False, self.modes[2], audio, None, .4, *([.1] * 8), 'Preset emotion', True,
                    *[DEFAULT_RECIPE[k] for k in ('do_sample', 'top_p', 'top_k', 'temperature', 'length_penalty',
                                                 'num_beams', 'repetition_penalty', 'max_mel_tokens', 'max_text_tokens_per_segment')]]
        return [{'__type__': 'update', 'value': audio}]

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
