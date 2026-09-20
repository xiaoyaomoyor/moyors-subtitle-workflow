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
    styles=normalize_styles((project.get('preview') or {}).get('burn_subtitles'))
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
    for index,name in enumerate(('main','secondary')):
        if target not in {name,'both'} or index>=len(groups):continue
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
