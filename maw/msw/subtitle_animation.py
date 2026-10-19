"""Subtitle animation contract and source-time evaluation for all ASS outputs."""
from copy import deepcopy
import math

SCHEMA = 'msw.subtitle-animation.v1'
DEFINITIONS = dict(
    fade=dict(enabled=False, unit='percent', **{'in': 10, 'out': 10}),
    typewriter=dict(enabled=False, unit='percent', start=0, end=40),
    blink=dict(enabled=False, unit='percent', start=0, end=100, period=600, opacity=0),
    transform=dict(enabled=False, unit='percent', start=0, end=25, fromX=0, fromY=0, toX=0, toY=0,
                   fromScale=85, toScale=100, fromRotation=0, toRotation=0, fromOpacity=100, toOpacity=100, easing='smooth'))


def timings(name):
    return ('in', 'out') if name == 'fade' else ('start', 'end')


def valid(raw):
    if not isinstance(raw, dict) or set(raw) != {'schema', 'effects'} or raw['schema'] != SCHEMA or not isinstance(raw['effects'], dict):
        return False
    for name, effect in raw['effects'].items():
        default = DEFINITIONS.get(name)
        if not default or not isinstance(effect, dict) or set(effect) != set(default):
            return False
        for key, value in effect.items():
            if key == 'enabled':
                ok = type(value) is bool
            elif key == 'unit':
                ok = value in ('percent', 'ms')
            elif key == 'easing':
                ok = value in ('linear', 'ease-in', 'ease-out', 'smooth')
            else:
                low, high = ((0, 100 if effect['unit'] == 'percent' else 60000) if key in timings(name)
                             else (80, 60000) if key == 'period' else (0, 100) if key.endswith('Opacity') or key == 'opacity'
                             else (1, 1000) if key.endswith('Scale') else (-360, 360) if key.endswith('Rotation') else (-4096, 4096))
                ok = type(value) in (int, float) and math.isfinite(value) and low <= value <= high
            if not ok:
                return False
        if name != 'fade' and effect['end'] <= effect['start']:
            return False
    return True


def normalize(raw):
    if not valid(raw):
        raise ValueError('字幕动画参数无效')
    return dict(schema=SCHEMA, effects={**deepcopy(DEFINITIONS), **deepcopy(raw['effects'])})


def resolve(base=None, override=None):
    if base is None and override is None:
        return None
    return normalize(dict(schema=SCHEMA, effects={**(base or {}).get('effects', {}), **(override or {}).get('effects', {})}))


def ms(effect, key, duration):
    return effect[key] * (duration / 100 if effect['unit'] == 'percent' else 1)


def clamp(value, low=0, high=1):
    return max(low, min(high, value))


def sample(raw, elapsed, duration, count=0):
    f, w, b, t = (raw['effects'][key] for key in DEFINITIONS)
    time = clamp(elapsed, 0, duration)
    state = dict(opacity=1, x=0, y=0, scale=100, rotation=0, revealed=count)
    if f['enabled']:
        a, z = ms(f, 'in', duration), ms(f, 'out', duration)
        if a + z > duration:
            ratio = duration / (a + z)
            a *= ratio
            z *= ratio
        state['opacity'] = min(time / a if a else 1, (duration-time) / z if z else 1, 1)
    if b['enabled'] and ms(b, 'start', duration) <= time < ms(b, 'end', duration) and math.floor((time-ms(b, 'start', duration))/(b['period']/2)) % 2:
        state['opacity'] *= b['opacity']/100
    if t['enabled']:
        p = clamp((time-ms(t, 'start', duration))/(ms(t, 'end', duration)-ms(t, 'start', duration)))
        p = p*p if t['easing'] == 'ease-in' else 1-(1-p)**2 if t['easing'] == 'ease-out' else p*p*(3-2*p) if t['easing'] == 'smooth' else p
        for key, suffix in [('x', 'X'), ('y', 'Y'), ('scale', 'Scale'), ('rotation', 'Rotation')]:
            state[key] = t['from'+suffix] + (t['to'+suffix]-t['from'+suffix])*p
        state['opacity'] *= (t['fromOpacity']+(t['toOpacity']-t['fromOpacity'])*p)/100
    if w['enabled']:
        state['revealed'] = math.floor(clamp((time-ms(w, 'start', duration))/(ms(w, 'end', duration)-ms(w, 'start', duration)))*count+1e-7)
    return state


def boundaries(raw, duration, count):
    """Critical times plus bounded smooth interpolation; never a wall-clock timer."""
    cuts = {0, duration}
    for name, effect in raw['effects'].items():
        if not effect['enabled']:
            continue
        if name == 'fade':
            a, z = ms(effect, 'in', duration), ms(effect, 'out', duration)
            ratio = min(1, duration/(a+z)) if a+z else 1
            cuts.update((a*ratio, duration-z*ratio))
            continue
        a, b = ms(effect, 'start', duration), ms(effect, 'end', duration)
        cuts.update((a, b))
        step = effect['period']/2 if name == 'blink' else (b-a)/max(1, count) if name == 'typewriter' else 40
        end = min(b, duration)
        if name == 'transform' and effect['easing'] == 'linear':
            continue
        steps = math.ceil(max(0, end-a)/step)
        if steps > 4096:
            raise ValueError('字幕动画生成片段过多，请缩短动画时段或增大闪烁间隔')
        cuts.update(a+i*step for i in range(1, steps))
    result = sorted(t for t in cuts if 0 <= t <= duration)
    if len(result) > 4096:
        raise ValueError('字幕动画生成片段过多，请减少效果或缩短动画时段')
    # Fade multiplied by a transform's opacity is nonlinear even with linear easing.
    if raw['effects']['fade']['enabled'] and raw['effects']['transform']['enabled']:
        result = sorted(set(result) | {a+(b-a)*i/4 for a, b in zip(result, result[1:]) for i in (1, 2, 3)})
    return result


def fragments(raw, text, style, duration, lo, hi, x, y, alignment, speaker_prefix='', speaker_color=None):
    """Yield source-relative fragments. Hidden text retains its original geometry."""
    from maw.subtitle_wrapping import _characters
    from maw.msw.subtitle_style import ass_text
    units = _characters(text)
    count = sum(not unit.isspace() for unit in units)
    cuts = [lo] + [t for t in boundaries(raw, duration, count) if lo < t < hi] + [hi]
    def number(v):
        return f'{v:.4f}'.rstrip('0').rstrip('.') or '0'
    def alpha(v):
        return f'{math.floor(clamp(1-v)*255+.5):02X}'
    def props(state):
        return (rf'\fscx{number(style["scaleX"]*state["scale"]/100)}'
                rf'\fscy{number(style["scaleY"]*state["scale"]/100)}'
                rf'\frz{number(style["angle"]+state["rotation"])}\alpha&H{alpha(state["opacity"])}&')
    def color_tag(color):
        return r'{\c&H'+color[5:7]+color[3:5]+color[1:3]+'&}'
    for a, b in zip(cuts, cuts[1:]):
        mid = sample(raw, (a+b)/2, duration, count)
        if not mid['revealed'] or mid['opacity'] <= 0:
            continue
        # Blink is discontinuous; evaluate both limits inside this fragment.
        left, right = sample(raw, a+1e-6, duration, count), sample(raw, b-1e-6, duration, count)
        span = b-a
        movement = any(abs(left[k]-right[k]) > 1e-6 for k in ('x', 'y'))
        xy = [x+left['x'], y+left['y'], x+right['x'], y+right['y']]
        position = ('\\move('+','.join(number(v) for v in [*xy, 0, span])+')' if movement
                    else '\\pos('+','.join(number(v) for v in xy[:2])+')')
        tags = rf'\an{alignment}\q2'+position+props(left)
        if props(left) != props(right):
            tags += r'\t(0,'+number(span)+',1,'+props(right)+')'
        parts, seen, prefix_count, hidden = [], 0, 0, False
        if speaker_color and speaker_prefix:
            parts.append(color_tag(speaker_color))
        for unit in units:
            if not unit.isspace():
                seen += 1
            if seen > mid['revealed'] and not hidden:
                # Override the alpha transform for the invisible tail too.
                parts.append(r'{\alpha&HFF&\t(0,'+number(span)+r',1,\alpha&HFF&)}')
                hidden = True
            if speaker_color and speaker_prefix and prefix_count == len(speaker_prefix):
                parts.append(color_tag(style['primaryColor']))
                prefix_count += 1
            parts.append(ass_text(unit))
            if unit != '\n':
                prefix_count += len(unit)
        yield a, b, tags, ''.join(parts)
