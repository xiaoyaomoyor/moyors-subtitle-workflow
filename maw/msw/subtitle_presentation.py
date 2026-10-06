"""Deterministic subtitle grouping and offsets shared with the browser."""
import math


def visible(project, cue):
    legacy = (project.get('subtitle_layers') or {}).get('legacy_overlay') or {}
    return not cue.get('disabled') and not (legacy.get('visible') is False and cue.get('id') in legacy.get('cue_ids', []))


def presentation(project, styles, target='both', width=1920):
    preview = project.get('preview') or {}
    pair = (preview.get('project_style') or {}).get('pairLayout') or preview.get('subtitle_pair_layout')
    rows = []
    if pair or target != 'secondary':
        rows.extend(('main', cue) for cue in project.get('segments', []) if visible(project, cue))
    multi = project.get('multi_subtitle') or {}
    tracks = multi.get('tracks') or []
    if (pair or target != 'main') and multi.get('enabled') and tracks:
        rows.extend(('secondary', cue) for cue in tracks[0].get('segments', []) if not cue.get('disabled'))
    bound = {}
    for binding in multi.get('bindings', []):
        if not tracks or binding.get('track_id') != tracks[0]['id']:
            continue
        for role, field in [('main', 'main_segment_ids'), ('secondary', 'extension_segment_ids')]:
            for cue_id in binding.get(field, []):
                bound[role, cue_id] = ('binding', binding['id'])
    groups, unbound_times = {}, {}
    if pair:
        for role, cue in rows:
            if (role, cue['id']) not in bound:
                time = (cue['start'], cue['end'])
                unbound_times[time] = unbound_times.get(time, 0) | (1 if role == 'main' else 2)
    for role, cue in rows:
        time = (cue['start'], cue['end'])
        identity = bound.get((role, cue['id']), ('paired-time', time) if unbound_times.get(time) == 3 else (role, cue['id']))
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
        group['paired'] = bool(pair) and {role for role, _ in group['rows']} == {'main', 'secondary'}
        upper = 'secondary' if group['paired'] and pair['order'] == 'secondary-above' else 'main'
        group['rows'].sort(key=lambda entry: (0 if entry[0] == upper else 1, entry[1]['start']))
        previous_role = None
        pair_bottom = max(styles[role]['y'] * 1080 for role, _ in group['rows']) if group['paired'] else 0
        for role, cue in reversed(group['rows']):
            style = styles[role]
            capacity = max(1, math.floor(width * style['width'] / (style['font_size'] * .55)))
            lines = sum(max(1, math.ceil(sum(2 if ord(c) > 255 else 1 for c in line) / capacity)) for line in cue.get('text', '').split('\n'))
            anchor = style['y'] * 1080
            edge = (pair_bottom if previous_role is None else next_bottom - (pair['gap'] if previous_role != role else 0)) if group['paired'] else min(anchor, next_bottom)
            group['local'][role, cue['id']] = anchor - edge
            next_bottom = edge - style['font_size'] * 1.2 * lines
            previous_role = role
            top, bottom = min(top, next_bottom), max(bottom, edge)
        heights[lane] = max(heights[lane], bottom - top + settings.get('gap', 12))
    return {(role, cue['id']): ((0 if settings.get('mode') == 'manual' else sum(heights[group['lane']+1:] if settings.get('order') == 'earlier-top' else heights[:group['lane']]))
                              + (group['local'][role, cue['id']] if settings.get('mode') != 'manual' or group['paired'] else 0))
            for group in ordered for role, cue in group['rows'] if target == 'both' or role == target}
