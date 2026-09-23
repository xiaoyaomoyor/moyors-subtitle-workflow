"""Validated project subtitle burn styles, shared by frame preview and MP4.

Positions are normalized against the picture; font and outline sizes use a
1080-high ASS canvas so exports do not depend on the editor's window size.
"""
import copy
import math
import re

from maw.msw.subtitle_export import mapped_subtitles

DEFAULTS = {
    'main': dict(font_family='Arial',font_size=48,color='#ffffff',outline_color='#000000',outline=2,
                 background_color='#000000',background_alpha=0,x=.5,y=.86,width=.8),
    'secondary': dict(font_family='Arial',font_size=40,color='#ffffff',outline_color='#000000',outline=2,
                      background_color='#000000',background_alpha=0,x=.5,y=.94,width=.8),
}


def normalize_styles(raw=None):
    if raw is not None and not isinstance(raw,dict):
        raise ValueError('字幕导出样式无效')
    result = copy.deepcopy(DEFAULTS)
    for track in result:
        style = (raw or {}).get(track,{})
        if not isinstance(style,dict):
            raise ValueError('字幕导出样式无效')
        for key,value in style.items():
            if key not in result[track]:
                raise ValueError('未知字幕样式字段')
            if key == 'font_family':
                if not isinstance(value,str) or not 1<=len(value)<=128 or any(ord(c)<32 or c in ',{}\\' for c in value):
                    raise ValueError('字幕字体名称无效')
            elif key in {'color','outline_color','background_color'}:
                if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):
                    raise ValueError('字幕颜色无效')
            else:
                limits = {'font_size':(8,200),'outline':(0,12),'background_alpha':(0,1),'x':(0,1),'y':(0,1),'width':(.1,1)}
                lo,hi = limits[key]
                if type(value) not in (int,float) or not math.isfinite(value) or not lo<=value<=hi:
                    raise ValueError('字幕样式参数超出范围')
            result[track][key]=value
    return result


def ass_color(value, alpha=0):
    return f'&H{alpha:02X}{value[5:7]}{value[3:5]}{value[1:3]}'


def ass_time(ms):
    centis=max(0,math.floor(ms/10+.5));seconds,cs=divmod(centis,100);minutes,s=divmod(seconds,60);h,m=divmod(minutes,60)
    return f'{h}:{m:02}:{s:02}.{cs:02}'


def ass_text(text):
    return str(text).replace('\\','\\\\').replace('{','\\{').replace('}','\\}').replace('\r\n','\n').replace('\r','\n').replace('\n',r'\N')


def styled_ass(project, plan, target, video, *, start_ms=0, end_ms=math.inf, frame_at=None):
    if (project.get('preview') or {}).get('ass_library_exports') is True:
        return library_ass(project, plan, target, video, start_ms=start_ms, end_ms=end_ms, frame_at=frame_at)
    styles=normalize_styles((project.get('preview') or {}).get('burn_subtitles'))
    if (project.get('overlay_track') or {}).get('enabled') is True:
        styles['overlay'] = dict(styles['main'])
        anchor = styles['secondary'] if (project.get('multi_subtitle') or {}).get('enabled') is True else styles['main']
        styles['overlay']['y'] = max(.05, anchor['y'] - 1.2 * anchor['font_size'] / 1080)
    width=max(1,round(1080*video['width']/max(1,video['height'])))
    lines=['[Script Info]','ScriptType: v4.00+',f'PlayResX: {width}','PlayResY: 1080','ScaledBorderAndShadow: yes','WrapStyle: 0','',
           '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding']
    for name,s in styles.items():
        left=round(max(0,s['x']-s['width']/2)*width);right=round(max(0,1-s['x']-s['width']/2)*width)
        for background in (False,True):
            primary=ass_color(s['color'],255 if background else 0)
            border=ass_color(s['background_color'],round((1-s['background_alpha'])*255)) if background else ass_color(s['outline_color'])
            lines.append(f"Style: {name}{'-bg' if background else ''},{s['font_family']},{s['font_size']},{primary},{primary},{border},{border},0,0,0,0,100,100,0,0,{3 if background else 1},{6 if background else s['outline']},0,2,{left},{right},{round((1-s['y'])*1080)},1")
    lines += ['', '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    groups=mapped_subtitles(project,plan)
    selected = [(i, name) for i, name in enumerate(('main', 'secondary')) if target in {name, 'both'}]
    if 'overlay' in styles and target != 'none': selected.append((len(groups)-1, 'overlay'))
    for index,name in selected:
        if index>=len(groups):continue
        style=styles[name]
        for cue in groups[index][1]:
            if not cue['text'].strip():continue
            if frame_at is not None:
                if not cue['start']<=frame_at<cue['end']:continue
                start,end=0,1000
            else:
                start,end=max(cue['start'],start_ms)-start_ms,min(cue['end'],end_ms)-start_ms
                if end<=start:continue
            # Margin-based positioning keeps libass line wrapping within the
            # configured box; main and secondary retain independent styles.
            text=ass_text(cue['text'])
            if style['background_alpha']>0:
                lines.append(f'Dialogue: 0,{ass_time(start)},{ass_time(end)},{name}-bg,,0,0,0,,{text}')
            lines.append(f'Dialogue: 1,{ass_time(start)},{ass_time(end)},{name},,0,0,0,,{text}')
    return '\n'.join(lines)+'\n'


def library_ass(project, plan, target, video, *, start_ms=0, end_ms=math.inf, frame_at=None):
    """Render the style library frozen in this export's project snapshot.

    Never read the live user library from a rendering worker: editing shared
    styles during a queued job must not change its output.
    """
    from maw.ass_styles import normalize_ass_style_library, find_ass_profile, find_ass_style, ass_style_line
    from maw.speaker import COLOR_PALETTE

    preview = project.get('preview') or {}
    snapshot = preview.get('burn_ass_library')
    if not isinstance(snapshot, dict):
        raise ValueError('缺少 ASS 样式快照，请重新开始导出')
    library = normalize_ass_style_library(snapshot)
    profile = find_ass_profile(library, library['assignments']['assExportProfileId'])
    main = find_ass_style(library, profile['styleId'])
    secondary = find_ass_style(library, library['assignments']['assExtensionStyleId'])
    groups = mapped_subtitles(project, plan, include_styles=True)
    anchor = secondary if len(groups) > 1 and groups[1][1] else main
    overlay = dict(main, alignment=anchor['alignment'], marginL=anchor['marginL'], marginR=anchor['marginR'],
                   marginV=anchor['marginV'] + round(1.2 * anchor['fontSize']))
    styles = {'main': main, 'secondary': secondary, 'overlay': overlay}
    selected = [(i, name) for i, name in enumerate(('main', 'secondary')) if target in {name, 'both'}]
    if (project.get('overlay_track') or {}).get('enabled') is True and target != 'none':
        selected.append((len(groups)-1, 'overlay'))
    width = max(1, round(1080 * video['width'] / max(1, video['height'])))
    lines = ['[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {width}', 'PlayResY: 1080',
             'ScaledBorderAndShadow: yes', 'WrapStyle: 0', '', '[V4+ Styles]',
             'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding']
    palette = dict(COLOR_PALETTE)
    for entry in project.get('color_palette') or []:
        if isinstance(entry, dict) and entry.get('name') in palette and re.fullmatch(r'#[0-9a-fA-F]{6}', str(entry.get('value', ''))):
            palette[entry['name']] = entry['value']
    mode = (preview.get('subtitle') or {}).get('ass_color_style', 'text')
    for name, style in styles.items():
        lines.append(ass_style_line(style, name=name))
        if name != 'secondary' and mode in {'text', 'stroke'}:
            for color_name, value in palette.items():
                variant = dict(style)
                if mode == 'stroke': variant['outlineColor'] = value
                else: variant.update(primaryColor=value, secondaryColor=value)
                lines.append(ass_style_line(variant, name=f'{name}-{color_name}'))
    lines += ['', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    animations = profile['animations']
    for index, name in selected:
        if index >= len(groups): continue
        tags = []
        for tag, keys in [('fad', ('inMs', 'outMs')), ('fade', ('alpha1', 'alpha2', 'alpha3', 't1', 't2', 't3', 't4')),
                          ('move', ('x1', 'y1', 'x2', 'y2', 't1', 't2')), ('t', ('startMs', 'endMs', 'accel', 'tags'))]:
            animation = animations[tag]
            if animation['enabled'] and not (tag == 'move' and name != 'main'):
                tags.append('\\' + tag + '(' + ','.join(str(animation[k]) for k in keys) + ')')
        prefix = '{' + ''.join(tags) + '}' if tags else ''
        for cue in groups[index][1]:
            if not cue['text'].strip(): continue
            if frame_at is not None:
                if not cue['start'] <= frame_at < cue['end']: continue
                # Use the same elapsed cue time as the rendered video.
                start, end = cue['start'], cue['end']
            else:
                start, end = max(cue['start'], start_ms)-start_ms, min(cue['end'], end_ms)-start_ms
                if end <= start: continue
            color = cue.get('color') or {}
            color_name = color.get('name')
            style_name = f'{name}-{color_name}' if name != 'secondary' and mode in {'text', 'stroke'} and color_name in palette else name
            layer = {'main': 0, 'secondary': 1, 'overlay': 2}[name]
            lines.append(f'Dialogue: {layer},{ass_time(start)},{ass_time(end)},{style_name},,0,0,0,,{prefix}{ass_text(cue["text"])}')
    return '\n'.join(lines) + '\n'
