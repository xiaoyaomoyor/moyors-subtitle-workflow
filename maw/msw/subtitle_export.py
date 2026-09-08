"""Subtitle projection shared by video burning and editable timeline exports."""

from bisect import bisect_right
import html
import math


def mapped_subtitles(project, plan):
    groups = [('主字幕', project.get('segments', [])), *[(t.get('name') or '副字幕', t.get('segments', []))
               for t in (project.get('multi_subtitle') or {}).get('tracks', [])]]
    result = []
    ends = [k['end_ms'] for k in plan['intervals']]
    for name, segments in groups:
        cues = []
        for s in segments:
            if s.get('disabled'):
                continue
            for index in range(bisect_right(ends, s['start']), len(ends)):
                k = plan['intervals'][index]
                if k['start_ms'] >= s['end']:
                    break
                lo, hi = max(s['start'], k['start_ms']), min(s['end'], k['end_ms'])
                if hi > lo:
                    cues.append(dict(start=k['output_start_ms'] + lo - k['start_ms'],
                                     end=k['output_start_ms'] + hi - k['start_ms'], text=s.get('text', '')))
        result.append((name, sorted(cues, key=lambda c: c['start'])))
    return result


def srt(cues):
    def stamp(ms):
        seconds, milli = divmod(ms, 1000)
        minutes, seconds = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        return f'{hours:02}:{minutes:02}:{seconds:02},{milli:03}'
    return '\n'.join(f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}\n" for i, c in enumerate(cues, 1))


def burning_cues(project, plan, target):
    if target == 'none':
        return []
    groups = mapped_subtitles(project, plan)
    selected = groups[:1] if target == 'main' else groups[1:2] if target == 'secondary' else groups[:2]
    events, texts = {}, {}
    for _, cues in selected:
        for c in cues:
            if not c['text'].strip():
                continue
            index = len(texts)
            texts[index] = c['text'].strip()
            events.setdefault(c['start'], []).append((index, True))
            events.setdefault(c['end'], []).append((index, False))
    # One simultaneous caption per interval keeps bilingual lines together and
    # prevents independent subtitle tracks from drawing on top of each other.
    active, result, previous = set(), [], 0
    for at, changes in sorted(events.items()):
        if at > previous and active:
            result.append(dict(start=previous, end=at, text='\n'.join(texts[i] for i in sorted(active))))
        for index, entering in changes:
            if entering:
                active.add(index)
            else:
                active.discard(index)
        previous = at
    if not result:
        raise ValueError('导出范围内没有所选轨道的可压制字幕')
    return result


def slice_burning_cues(cues, start_ms, end_ms):
    result = []
    for c in cues:
        if c['end'] <= start_ms:
            continue
        if c['start'] >= end_ms:
            break
        start = math.floor(max(0, c['start'] - start_ms) + .5)
        end = math.floor(min(end_ms, c['end']) - start_ms + .5)
        if end > start:
            result.append(dict(start=start, end=end, text=html.escape(c['text'], quote=False)))
    return result
