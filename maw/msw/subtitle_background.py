"""ASS vector backgrounds, expressed relative to the text's rotation anchor."""
import math
import re

DEFAULTS = dict(backgroundShape='none', backgroundColor='#000000', backgroundOpacity=75,
                backgroundPaddingX=16, backgroundPaddingY=8, backgroundRadius=12)


def valid(style):
    for key in DEFAULTS:
        if key not in style:
            continue
        value = style[key]
        if key == 'backgroundShape':
            ok = value in ('none', 'rect', 'rounded')
        elif key == 'backgroundColor':
            ok = isinstance(value, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', value)
        else:
            ok = type(value) in (int, float) and math.isfinite(value) and 0 <= value <= (100 if key == 'backgroundOpacity' else 240)
        if not ok:
            return False
    return True


def normalize(style):
    if not valid(style):
        raise ValueError('字幕背景参数无效')
    return {k: style.get(k, v) for k, v in DEFAULTS.items()}


def enabled(style):
    return style.get('backgroundShape') in ('rect', 'rounded')


def box(style, size, alignment):
    s = normalize(style)
    px, py = size['padding']+s['backgroundPaddingX'], size['padding']+s['backgroundPaddingY']
    return dict(x=-((alignment-1) % 3)*size['textWidth']/2-px,
                y=-(2-(alignment-1)//3)*size['textHeight']/2-py,
                width=size['textWidth']+2*px, height=size['textHeight']+2*py)


def bounds(style, size, alignment):
    b = box(style, size, alignment)
    angle = math.radians(style['angle'])
    c, s = math.cos(angle), math.sin(angle)
    points = [(x*c+y*s, -x*s+y*c) for x in (b['x'], b['x']+b['width']) for y in (b['y'], b['y']+b['height'])]
    x, y = min(p[0] for p in points), min(p[1] for p in points)
    return dict(x=x, y=y, width=max(p[0] for p in points)-x, height=max(p[1] for p in points)-y)


def drawing(style, size, alignment):
    b = box(style, size, alignment)
    x, y, w, h = b['x'], b['y'], b['width'], b['height']
    radius = min(normalize(style)['backgroundRadius'], w/2, h/2) if style['backgroundShape'] == 'rounded' else 0
    commands = []
    def cmd(name, *values):
        commands.append(name+' '+' '.join(f'{v:.4f}'.rstrip('0').rstrip('.') or '0' for v in values))
    r, k = radius, radius*.5522847498
    cmd('m', x+r, y)
    cmd('l', x+w-r, y)
    if r: cmd('b', x+w-r+k, y, x+w, y+r-k, x+w, y+r)
    cmd('l', x+w, y+h-r)
    if r: cmd('b', x+w, y+h-r+k, x+w-r+k, y+h, x+w-r, y+h)
    cmd('l', x+r, y+h)
    if r: cmd('b', x+r-k, y+h, x, y+h-r+k, x, y+h-r)
    cmd('l', x, y+r)
    if r: cmd('b', x, y+r-k, x+r-k, y, x+r, y)
    else: cmd('l', x, y)
    return ' '.join(commands)


def tags(style):
    s = normalize(style)
    color = s['backgroundColor']
    alpha = math.floor((1-s['backgroundOpacity']/100)*255+.5)
    return (r'\an7\p1\pbo0\b0\i0\u0\s0\bord0\shad0\fsp0\fscx100\fscy100'
            +r'\1c&H'+color[5:7]+color[3:5]+color[1:3]+rf'&\alpha&H{alpha:02X}&')


def legacy_tags(style, animations, x, y):
    """Share motion, not glyph colors/borders, with legacy ASS animations."""
    opacity = normalize(style)['backgroundOpacity']/100
    def alpha(value):
        return math.floor(255-(255-value)*opacity+.5)
    result = tags(style)+r'\q2'
    move = animations['move']
    if move['enabled']:
        result += r'\move('+','.join(str(round(v,4)) for v in (x,y,x+move['x2']-move['x1'],y+move['y2']-move['y1'],move['t1'],move['t2']))+')'
    else:
        result += rf'\pos({x:.4f},{y:.4f})'
    fad, fade, transform = (animations[k] for k in ('fad','fade','t'))
    if fad['enabled']:
        result += rf'\fad({fad["inMs"]},{fad["outMs"]})'
    if fade['enabled']:
        values = [alpha(fade[k]) for k in ('alpha1','alpha2','alpha3')]+[fade[k] for k in ('t1','t2','t3','t4')]
        result += r'\fade('+','.join(map(str,values))+')'
    if transform['enabled']:
        pieces = []
        for match in re.finditer(r'\\(fscx|fscy|frz|frx|fry|fr|blur|be)(-?\d+(?:\.\d+)?)|\\(alpha|1a)&H([0-9a-fA-F]{1,2})&',transform['tags']):
            name, number, opacity_tag, hex_value = match.groups()
            if opacity_tag:
                pieces.append(rf'\alpha&H{alpha(int(hex_value,16)):02X}&')
            else:
                value=float(number)
                if name in ('fscx','fscy'):
                    value *= 100/(style['scaleX' if name=='fscx' else 'scaleY'] or 100)
                pieces.append('\\'+name+f'{value:g}')
        if pieces:
            result += rf'\t({transform["startMs"]},{transform["endMs"]},{transform["accel"]},'+''.join(pieces)+')'
    return result
