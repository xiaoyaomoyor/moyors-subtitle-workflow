"""Deterministic subtitle grouping and offsets shared with the browser."""
import math
from maw.msw.subtitle_fonts import wrapped_line_count


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
    groups, unbound_groups = {}, {}
    if pair:
        unbound = sorted(((role, cue) for role, cue in rows if (role, cue['id']) not in bound), key=lambda entry: entry[1]['start'])
        component, end = [], -math.inf
        def flush():
            if {role for role, _ in component} == {'main', 'secondary'}:
                identity = ('paired-overlap', component[0][0], component[0][1]['id'])
                for role, cue in component:
                    unbound_groups[role, cue['id']] = identity
        for role, cue in unbound:
            if cue['start'] >= end:
                flush()
                component, end = [], -math.inf
            component.append((role, cue))
            end = max(end, cue['end'])
        flush()
    for role, cue in rows:
        identity = bound.get((role, cue['id']), unbound_groups.get((role, cue['id']), (role, cue['id'])))
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
        def height(role, cue):
            style = styles[role]
            lines = wrapped_line_count(cue.get('text', ''), style, width)
            return style['font_size'] * 1.2 * style.get('scale_y', 100) / 100 * lines
        if group['paired']:
            bands = {}
            for role in ('main', 'secondary'):
                ends, sizes, band_rows = [], [], []
                for current_role, cue in group['rows']:
                    if role != current_role:
                        continue
                    slot = next((i for i, end in enumerate(ends) if end <= cue['start']), len(ends))
                    if slot == len(ends):
                        ends.append(0)
                        sizes.append(0)
                    ends[slot] = cue['end']
                    sizes[slot] = max(sizes[slot], height(role, cue))
                    band_rows.append((cue, slot))
                bands[role] = dict(rows=band_rows, sizes=sizes, height=sum(sizes))
            lower = 'secondary' if upper == 'main' else 'main'
            base = styles[lower]['y'] * 1080
            distance = max(1, (bands[lower]['height'] - bands[upper]['height']) / 2 + 1, bands[lower]['height'] + pair['gap'])
            for role in (lower, upper):
                for cue, slot in bands[role]['rows']:
                    edge = base - (distance if role == upper else 0) - sum(bands[role]['sizes'][slot+1:])
                    group['local'][role, cue['id']] = styles[role]['y'] * 1080 - edge
            heights[lane] = max(heights[lane], max(bands[lower]['height'], distance + bands[upper]['height']) + settings.get('gap', 12))
            continue
        for role, cue in reversed(group['rows']):
            anchor = styles[role]['y'] * 1080
            edge = min(anchor, next_bottom)
            group['local'][role, cue['id']] = anchor - edge
            next_bottom = edge - height(role, cue)
            top, bottom = min(top, next_bottom), max(bottom, edge)
        heights[lane] = max(heights[lane], bottom - top + settings.get('gap', 12))
    return {(role, cue['id']): ((0 if settings.get('mode') == 'manual' else sum(heights[group['lane']+1:] if settings.get('order') == 'earlier-top' else heights[:group['lane']]))
                              + (group['local'][role, cue['id']] if settings.get('mode') != 'manual' or group['paired'] else 0))
            for group in ordered for role, cue in group['rows'] if target == 'both' or role == target}
