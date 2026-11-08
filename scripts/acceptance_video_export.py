"""Opt-in complete synthetic video export; never reads personal projects/services."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from maw.ffmpeg import resolve_ffmpeg_tools
from maw.msw.audio_render import probe_source
from maw.msw.video_render import prepare, render_video
from maw.msw.track_presentation import layout, fixed_ass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--ffmpeg', default=os.environ.get('MSW_E2E_FFMPEG'))
    parser.add_argument('--encoding', choices=['auto', 'h264'], default='auto')
    args = parser.parse_args()
    root = Path(args.out).resolve()
    root.mkdir(parents=True, exist_ok=False)
    report = dict(schema='msw.video-acceptance.v1', status='running', requestedEncoding=args.encoding, cases=[])
    cancel = threading.Event()
    tools = resolve_ffmpeg_tools(configured_path=args.ffmpeg)
    assert tools.complete, 'FFmpeg and FFprobe are required'

    def persist():
        (root/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

    def command(argv):
        return subprocess.run([str(x) for x in argv], check=True, capture_output=True,
                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout

    def media(path, width, height, fps, seconds):
        command([tools.ffmpeg, '-v', 'error', '-f', 'lavfi', '-i',
                 f'color=black:s={width}x{height}:r={fps}:d={seconds}',
                 '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', str(seconds),
                 '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                 '-c:a', 'aac', path])

    def fixture(profile):
        code = "import {createFixture} from './scripts/performance/fixtures.mjs'; console.log(JSON.stringify(createFixture(process.argv[1],10000).project));"
        return json.loads(command(['node', '--input-type=module', '-e', code, profile]))

    def verify_ass(project, plan, info):
        rows = layout(project, 1920)
        visible = {t['id'] for t in project['subtitles']['tracks'] if t['enabled']}
        expected = {c['id'] for c in project['subtitles']['cues'] if c['track_id'] in visible
                    and not c.get('hidden') and not c['content'].get('disabled') and c['content']['text'].strip()
                    and c['content']['start'] < plan['source_end_ms'] and c['content']['end'] > plan['source_start_ms']}
        ass = fixed_ass(project, plan, 'both', info['video'], entries=rows)
        events = [line.split(',', 9) for line in ass.splitlines() if line.startswith('Dialogue:')]
        emitted = {rows[int(event[3].removeprefix('cue-'))]['cue_id'] for event in events}
        assert emitted == expected, f'Missing/extra cues: {expected-emitted} / {emitted-expected}'
        assert len(rows) == len({r['cue_id'] for r in rows}), 'Duplicate layout row'
        compact = lambda s: re.sub(r'\s+', '', s)
        for row in rows:
            assert compact(row['cue']['text']) in compact(row['size']['text']), row['cue_id']
        return ass, dict(expectedCues=len(expected), emittedCues=len(emitted), events=len(events),
                         assBytes=len(ass.encode()), bindings=len(project['subtitles']['bindings']))

    try:
        source = root/'source.mp4'
        media(source, 640, 360, 2, 7200)
        for profile in ['bound', 'mixed']:
            project = fixture(profile)
            project['media'] = source.name
            if profile == 'mixed':
                # Materialize the same deterministic audio samples as the browser matrix.
                data = command(['node', '--input-type=module', '-e', "import {audioFixture} from './scripts/performance/fixtures.mjs';process.stdout.write(audioFixture());"])
                for asset in project['msw']['assets']:
                    path = root/asset['path']; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            (root/f'{profile}.mosp').write_text(json.dumps(project, ensure_ascii=False), encoding='utf-8')
            before = copy.deepcopy(project)
            info = probe_source(tools.ffprobe, source, cancel)
            settings = dict(mode='mix', duration_ms=7200000, video_tail='truncate', video_encoding=args.encoding, burn_subtitles='both')
            plan = prepare(project, settings, info)
            ass, evidence = verify_ass(project, plan, info)
            (root/f'{profile}.ass').write_text(ass, encoding='utf-8')
            entry = dict(profile=profile, **evidence, status='rendering')
            report['cases'].append(entry);persist()
            assets = {a['id']: a for a in project.get('msw', {}).get('assets', [])}
            output = root/f'{profile}.mp4'
            started = time.perf_counter()
            result = render_video(plan, output, tools, cancel, lambda *_: None,
                                  lambda identifier: (assets[identifier], root/assets[identifier]['path']),
                                  source=source, source_channels=1, info=info, settings=settings, project=project)
            assert project == before, 'Export mutated the source project'
            actual = probe_source(tools.ffprobe, output, cancel)
            assert abs(actual['duration_ms']-7200000) <= 525
            decoded = json.loads(command([tools.ffprobe, '-v', 'error', '-count_frames', '-select_streams', 'v:0',
                                          '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', output]))['streams'][0]
            assert int(decoded['nb_read_frames']) == 14400, decoded
            command([tools.ffmpeg, '-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
            from PIL import Image
            samples = []
            cues = [c for c in project['subtitles']['cues'] if c['track_id']=='s1']
            for index in [0, len(cues)//2, len(cues)-1]:
                cue = cues[index]['content']
                at = (int(cue['start']/500)+1)*.5
                png = root/f'{profile}-sample-{index}.png'
                command([tools.ffmpeg, '-v', 'error', '-ss', str(at), '-i', output, '-frames:v', '1', png])
                image = Image.open(png).convert('RGB')
                pixel_data = getattr(image, 'get_flattened_data', image.getdata)()
                pixels = sum(max(pixel)>60 for pixel in pixel_data)
                assert pixels > 100, 'Burned subtitles absent on a sampled black frame'
                samples.append(dict(second=at, nonBlackPixels=pixels))
            entry.update(status='complete', renderSeconds=time.perf_counter()-started, durationMs=actual['duration_ms'],
                         decodedFrames=14400, bytes=output.stat().st_size, samples=samples,
                         encoder=result['video_encoder'], sha256=hashlib.sha256(output.read_bytes()).hexdigest())
            persist();print(profile, 'complete', flush=True)

        # A full-resolution source exercises actual 1080p/30 decoding and burn.
        high = root/'highres-source.mp4';media(high,1920,1080,30,8)
        project = fixture('bound');project['media']=high.name
        info = probe_source(tools.ffprobe, high, cancel)
        settings = dict(mode='mix', duration_ms=8000, video_tail='truncate', video_encoding=args.encoding, burn_subtitles='both')
        plan = prepare(project, settings, info)
        _, evidence = verify_ass(project, plan, info)
        output = root/'highres-output.mp4'
        render_video(plan, output, tools, cancel, lambda *_: None, lambda _: None,
                     source=high, source_channels=1, info=info, settings=settings, project=project)
        actual = probe_source(tools.ffprobe, output, cancel)
        assert actual['video']['width']==1920 and actual['video']['height']==1080
        assert abs(actual['duration_ms']-8000)<=80
        command([tools.ffmpeg,'-v','error','-xerror','-i',output,'-f','null','-'])
        # Embedded cache makes the companion browser test independent of analysis jobs.
        code="import {waveform} from './scripts/performance/fixtures.mjs';console.log(JSON.stringify(waveform(8000)));"
        project['waveform']=json.loads(command(['node','--input-type=module','-e',code]))
        st=high.stat();project['waveform']['source']=dict(name=high.name,size=st.st_size,modified_ms=st.st_mtime_ns//1000000)
        (root/'highres.mosp').write_text(json.dumps(project,ensure_ascii=False),encoding='utf-8')
        report['highResolution']=dict(status='complete',width=1920,height=1080,durationMs=actual['duration_ms'],**evidence)
        report['status']='complete'
    except BaseException as exc:
        report.update(status='failed',error=str(exc));raise
    finally:
        persist()


if __name__ == '__main__':
    main()
