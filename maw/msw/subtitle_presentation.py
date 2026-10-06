"""Deterministic subtitle grouping and offsets shared with the browser."""
import math


def visible(project, cue):
    legacy = (project.get('subtitle_layers') or {}).get('legacy_overlay') or {}
    return not cue.get('disabled') and not (legacy.get('visible') is False and cue.get('id') in legacy.get('cue_ids', []))


def presentation(project, styles, target='both', width=1920):
    rows = []
    if target != 'secondary':
        rows.extend(('main', cue) for cue in project.get('segments', []) if visible(project, cue))
    multi = project.get('multi_subtitle') or {}
    tracks = multi.get('tracks') or []
    if target != 'main' and multi.get('enabled') and tracks:
        rows.extend(('secondary', cue) for cue in tracks[0].get('segments', []) if not cue.get('disabled'))
    bound = {}
    for binding in multi.get('bindings', []):
        if not tracks or binding.get('track_id') != tracks[0]['id']:
            continue
        for role, field in [('main', 'main_segment_ids'), ('secondary', 'extension_segment_ids')]:
            for cue_id in binding.get(field, []):
                bound[role, cue_id] = ('binding', binding['id'])
    groups = {}
    for role, cue in rows:
        identity = bound.get((role, cue['id']), (role, cue['id']))
        group = groups.setdefault(identity, dict(start=cue['start'], end=cue['end'], rows=[]))
        group['start'], group['end'] = min(group['start'], cue['start']), max(group['end'], cue['end'])
        group['rows'].append((role, cue))
    settings = (project.get('subtitle_layers') or {}).get('presentation') or {}
    ordered = sorted(groups.values(), key=lambda g: g['start'])
    lanes, heights = [], []
    for group in ordered:
        lane = next((i for i, end in enumerate(lanes) if end <= group['start']), len(lanes))
        if lane == len(lanes):
            lanes.append(0)
            heights.append(0)
        lanes[lane] = group['end']
        group['lane'] = lane
        top, bottom, next_bottom = math.inf, -math.inf, math.inf
        group['local'] = {}
        group['rows'].sort(key=lambda entry: (0 if entry[0] == 'main' else 1, entry[1]['start']))
        for role, cue in reversed(group['rows']):
            style = styles[role]
            capacity = max(1, math.floor(width * style['width'] / (style['font_size'] * .55)))
            lines = sum(max(1, math.ceil(sum(2 if ord(c) > 255 else 1 for c in line) / capacity)) for line in cue.get('text', '').split('\n'))
            anchor = style['y'] * 1080
            edge = min(anchor, next_bottom)
            group['local'][role, cue['id']] = anchor - edge
            next_bottom = edge - style['font_size'] * 1.2 * lines
            top, bottom = min(top, next_bottom), max(bottom, edge)
        heights[lane] = max(heights[lane], bottom - top + settings.get('gap', 12))
    return {(role, cue['id']): (0 if settings.get('mode') == 'manual' else sum(heights[group['lane']+1:] if settings.get('order') == 'earlier-top' else heights[:group['lane']]) + group['local'][role, cue['id']])
            for group in ordered for role, cue in group['rows']}
