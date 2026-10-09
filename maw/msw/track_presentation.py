"""Fixed track render compilation, shared by ASS preview and video burning.

Coordinates use a 1080-high picture canvas. Explicit bindings define groups;
annotations keep their anchors and only dialogue groups participate in packing.
"""
from copy import deepcopy
import math
import re

from maw.msw.subtitle_tracks import TrackIndex, key
from maw.msw.subtitle_fonts import family_metrics, installed_fonts
from maw.project_subtitle_style import normalize_project_style, builtin_presets
from maw.subtitle_wrapping import wrap_text, _characters


def measured_text(text, style, width, *, prefix=''):
    metrics = family_metrics(style['fontName'], style['bold'], style['italic'])
    registry = installed_fonts()
    fallback_name = next((n for n in ('microsoft yahei', 'pingfang sc', 'noto sans cjk sc', 'arial', 'dejavu sans') if n in registry), '')
    fallback = family_metrics(fallback_name, style['bold'], style['italic']) if fallback_name else {}
    sx, sy = style['scaleX']/100, style['scaleY']/100
    padding = (style['outline']+style['shadow'])*max(1, sx, sy)
    available = max(1, width-style['marginL']-style['marginR']-padding*2)
    def advance(token):
        return sum((metrics.get(ord(c), fallback.get(ord(c), 1.1 if ord(c)>255 else .55))*style['fontSize']+style['spacing'])*sx for c in token)
    lines = []
    for raw in (prefix+wrap_text(text, style)).replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        line, used = '', 0
        for token in re.findall(r'\s+|\S+', raw):
            size = advance(token)
            if line and used+size>available:
                lines.append(line.rstrip());line, used = '', 0
            # Unbroken CJK/long words must also fit the picture, as in the UI.
            for unit in _characters(token):
                amount = advance(unit)
                if line and used+amount>available:
                    lines.append(line.rstrip());line, used = '', 0
                if not line and unit.isspace():
                    continue
                line += unit;used += amount
        lines.append(line)
    w=max([advance(line) for line in lines]+[1]);h=max(1,len(lines))*style['fontSize']*1.2*sy
    anchor=((style['alignment']-1)%3)*w/2
    angle=math.radians(style['angle']);c,s=math.cos(angle),math.sin(angle)
    corners=[((x-anchor)*c+y*s,-(x-anchor)*s+y*c) for x in (-padding,w+padding) for y in (-padding,h+padding)]
    left=min(x for x,y in corners);top=min(y for x,y in corners)
    return dict(text='\n'.join(lines),width=max(x for x,y in corners)-left,height=max(y for x,y in corners)-top,
                padding=padding,originX=-left,originY=-top)


def pair_settings(style):
    if 'pairLayout' in style:
        return style['pairLayout']
    def height(s):return s['fontSize']*1.2*s['scaleY']/100
    def bottom(s):return s['marginV']+height(s) if s['alignment']>=7 else 540+height(s)/2 if s['alignment']>=4 else 1080-s['marginV']
    a,b=style['main'],style['secondary']
    order='main-above' if bottom(a)<=bottom(b) else 'secondary-above'
    gap=abs(bottom(a)-bottom(b))-height(b if order=='main-above' else a)
    return dict(order=order,gap=min(240,max(-240,math.floor(gap+.5))))


def layout(project, width=1920):
    index = TrackIndex(project)
    tracks = project['subtitle_tracks']['tracks']
    multi = project.get('multi_subtitle') or {}
    language = (multi.get('tracks') or [{}])[0].get('id')
    rows = [deepcopy(r) for r in index.records(include_disabled=False)
            if r['role']=='main' or multi.get('enabled') and r['track_id']==language]
    lookup = {key(r):r for r in rows}
    used, groups = set(), []
    default = (project.get('preview') or {}).get('project_style') or builtin_presets()[0]
    labels = (project.get('preview') or {}).get('burn_speaker_labels') or {}
    def add(refs):
        members = [lookup[key(r)] for r in refs if key(r) in lookup and key(r) not in used]
        if not members:
            return
        used.update(key(r) for r in members)
        track = index.tracks[members[0]['subtitle_track_id']]
        style = normalize_project_style(track['style']['value'] if track['style']['mode']=='snapshot' else default)
        if track['kind']=='annotation' and 'annotation' in style:
            style=style['annotation']
        pair = pair_settings(style)
        upper = 'extension' if pair['order']=='secondary-above' else 'main'
        group = dict(id=key(members[0]), trackId=track['id'], kind=track['kind'], rank=tracks.index(track), rows=members, style=style)
        members.sort(key=lambda r: r['role']!=upper)
        for row in members:
            row['style'] = style['main' if row['role']=='main' else 'secondary']
            cue = row['cue']
            storage = project['segments'] if row['role']=='main' else next(t['segments'] for t in multi['tracks'] if t['id']==row['track_id'])
            head = (cue.get('color_ref') or {}).get('headIdx')
            row['color'] = cue.get('color') or (storage[head].get('color') if type(head) is int and 0<=head<len(storage) else {}) or {}
            label = (labels.get('names') or {}).get(row['color'].get('name'), '') if labels.get('enabled') else ''
            prefix = label+labels.get('separator', '：') if label and row['role']=='main' else ''
            row['prefix']=prefix
            row['size'] = measured_text(cue.get('text', ''), row['style'], width, prefix=prefix)
        members[0]['localY'] = 0
        if len(members)==2:
            a,b = members
            b['localY'] = max(1, (a['size']['height']-b['size']['height'])/2+1, a['size']['height']+pair['gap'])
        group['width'] = max(r['size']['width'] for r in members)
        group['height'] = max(r['localY']+r['size']['height'] for r in members)
        group['start'] = min(r['cue']['start'] for r in members)
        group['position'] = next((r['cue']['subtitle_position'] for r in members if r['cue'].get('subtitle_position')), track.get('position'))
        if group['position'] is None and track['kind']=='annotation':
            group['position'] = dict(x=.5, y=.08)
        lower = members[-1]['style'];horizontal = (lower['alignment']-1)%3;vertical = (lower['alignment']-1)//3
        group['x'] = (group['position']['x']*width-group['width']/2 if group['position'] else
                      lower['marginL'] if horizontal==0 else width-lower['marginR']-group['width'] if horizontal==2 else (width-group['width'])/2)
        group['y'] = (group['position']['y']*1080 if group['position'] else lower['marginV'] if vertical==2 else
                      (1080-group['height'])/2 if vertical==1 else 1080-lower['marginV']-group['height'])
        groups.append(group)
    for b in multi.get('bindings', []):
        if b.get('track_id')==language:
            add([dict(role='main',track_id=None,cue_id=b['main_segment_ids'][0]),
                 dict(role='extension',track_id=language,cue_id=b['extension_segment_ids'][0])])
    for row in rows:
        if key(row) not in used:
            add([row])
    groups.sort(key=lambda g:(g['rank'],g['start'],g['id']))
    # Sweep actual member intervals: binding envelopes may contain empty time.
    neighbours = {g['id']:set() for g in groups}
    events = sorted((r['cue']['start'], r['cue']['end'], g['id']) for g in groups for r in g['rows'])
    active = []
    for start,end,identity in events:
        active = [(hi,other) for hi,other in active if hi>start]
        for _,other in active:
            if other!=identity:
                neighbours[identity].add(other);neighbours[other].add(identity)
        active.append((end,identity))
    by_id = {g['id']:g for g in groups}
    for g in groups:
        blocked = {by_id[n].get('lane') for n in neighbours[g['id']] if by_id[n]['trackId']==g['trackId'] and not by_id[n]['position']}
        lane=0
        while lane in blocked:lane+=1
        g['lane'] = lane if not g['position'] else 0
    groups.sort(key=lambda g:(g['rank'],g['lane'],g['start'],g['id']))
    gap=(project.get('subtitle_layers') or {}).get('presentation', {}).get('gap',12)
    entries=[]
    for g in groups:
        if g['kind']=='dialogue' and not g['position']:
            for identity in neighbours[g['id']]:
                other=by_id[identity]
                if other['kind']=='dialogue' and not other['position'] and (other['rank'],other['lane'])<(g['rank'],g['lane']):
                    g['y']=min(g['y'],other['y']-gap-g['height'])
        for r in g['rows']:
            align=(r['style']['alignment']-1)%3
            entries.append(dict(r,key=key(r),groupId=g['id'],rank=g['rank'],kind=g['kind'],animations=g['style']['animations'],
                x=g['x']+(0 if align==0 else g['width']-r['size']['width'] if align==2 else (g['width']-r['size']['width'])/2),
                y=g['y']+r['localY'],width=r['size']['width'],height=r['size']['height']))
    return entries


def fixed_ass(project, plan, target, video, *, start_ms=0, end_ms=math.inf, frame_at=None):
    from maw.ass_styles import ass_style_line
    from maw.msw.subtitle_style import ass_time, ass_text
    from maw.speaker import COLOR_PALETTE
    width=max(1,round(1080*video['width']/max(1,video['height'])))
    entries=layout(project,width)
    lines=['[Script Info]','ScriptType: v4.00+',f'PlayResX: {width}','PlayResY: 1080','ScaledBorderAndShadow: yes','WrapStyle: 2','',
           '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding']
    palette=dict(COLOR_PALETTE)
    palette.update({c['name']:c['value'] for c in project.get('color_palette',[]) if isinstance(c,dict) and c.get('name') in palette and re.fullmatch(r'#[0-9a-fA-F]{6}',str(c.get('value','')))})
    mode=(project.get('preview') or {}).get('subtitle',{}).get('ass_color_style','text')
    for i,r in enumerate(entries):
        style=dict(r['style']);color=palette.get(r['color'].get('name'))
        if color and r['role']=='main' and mode in ('text','stroke'):
            style['primaryColor' if mode=='text' else 'outlineColor']=color
        lines.append(ass_style_line(style,name=f'cue-{i}'))
    lines+=['','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for i,r in enumerate(entries):
        role='main' if r['role']=='main' else 'secondary'
        if target not in ('both',role) or not r['size']['text'].strip():continue
        align=(r['style']['alignment']-1)%3
        padding=r['size']['padding']
        x=r['x']+r['size']['originX']
        y=r['y']+r['size']['originY']
        base=rf'\an{7+align}\q2'
        animations=r['animations']
        move=animations['move']
        if move['enabled']:
            base+=r'\move('+','.join(str(round(v,4)) for v in (x,y,x+move['x2']-move['x1'],y+move['y2']-move['y1'],move['t1'],move['t2']))+')'
        else:base+=rf'\pos({x:.4f},{y:.4f})'
        for tag,keys in [('fad',('inMs','outMs')),('fade',('alpha1','alpha2','alpha3','t1','t2','t3','t4')),('t',('startMs','endMs','accel','tags'))]:
            a=animations[tag]
            if a['enabled']:base+='\\'+tag+'('+','.join(str(a[k]) for k in keys)+')'
        text=ass_text(r['size']['text'])
        color=palette.get(r['color'].get('name'))
        if color and mode=='speaker' and r['prefix']:
            count=cut=0
            for ch in r['size']['text']:
                cut+=1
                if ch!='\n':count+=1
                if count>=len(r['prefix']):break
            def tag(hex):return r'{\c&H'+hex[5:7]+hex[3:5]+hex[1:3]+'&}'
            text=tag(color)+ass_text(r['size']['text'][:cut])+tag(r['style']['primaryColor'])+ass_text(r['size']['text'][cut:])
        for interval in plan['intervals']:
            lo,hi=max(r['cue']['start'],interval['start_ms']),min(r['cue']['end'],interval['end_ms'])
            if hi<=lo:continue
            start=interval['output_start_ms']+lo-interval['start_ms'];end=start+hi-lo
            if frame_at is not None:
                if not start<=frame_at<end:continue
            else:start,end=max(start,start_ms)-start_ms,min(end,end_ms)-start_ms
            if end<=start:continue
            # Explicit positions suppress libass's implicit collision re-stacking.
            layer=r['rank']*2+(r['role']=='extension')
            lines.append(f'Dialogue: {layer},{ass_time(start)},{ass_time(end)},cue-{i},,0,0,0,,{{{base}}}{text}')
    return '\n'.join(lines)+'\n'
