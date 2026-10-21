"""Portable ASS text gradient: one fill color per visible grapheme."""
import math
import re

DEFAULTS = dict(gradientMode='none', gradientStart='#ffffff', gradientEnd='#b79cff')


def valid(style):
    return all(key not in style or (style[key] in ('none','characters') if key == 'gradientMode'
               else isinstance(style[key],str) and re.fullmatch(r'#[0-9a-fA-F]{6}',style[key])) for key in DEFAULTS)


def normalize(style):
    if not valid(style):
        raise ValueError('字幕渐变参数无效')
    return {key:style.get(key,value) for key,value in DEFAULTS.items()}


def enabled(style):
    return style.get('gradientMode') == 'characters'


def color(style, index, count):
    s=normalize(style)
    p=max(0,min(1,index/(count-1))) if count>1 else 0
    return '#'+''.join(f'{math.floor(int(s["gradientStart"][i:i+2],16)*(1-p)+int(s["gradientEnd"][i:i+2],16)*p+.5):02x}' for i in (1,3,5))


def tag(color):
    return r'{\1c&H'+color[5:7]+color[3:5]+color[1:3]+'&}'


def ass(text, style):
    from maw.subtitle_wrapping import _characters
    from maw.msw.subtitle_style import ass_text
    units=_characters(text)
    from maw.msw.subtitle_fonts import font_tags
    fonts=font_tags(units,style)
    count=sum(not u.isspace() for u in units)
    parts=[];index=0
    for unit, font in zip(units, fonts):
        if not unit.isspace():
            parts.append(tag(color(style,index,count)));index+=1
        parts.append(font+ass_text(unit))
    return ''.join(parts)
