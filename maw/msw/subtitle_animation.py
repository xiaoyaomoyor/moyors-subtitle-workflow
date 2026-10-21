"""Subtitle animation contract and source-time evaluation for all ASS outputs."""
from copy import deepcopy
import math

SCHEMA = 'msw.subtitle-animation.v1'
DEFINITIONS = dict(
    fade=dict(enabled=False, unit='percent', **{'in': 10, 'out': 10}),
    typewriter=dict(enabled=False, unit='percent', start=0, end=40),
    blink=dict(enabled=False, unit='percent', start=0, end=100, period=600, opacity=0),
    transform=dict(enabled=False, unit='percent', start=0, end=25, fromX=0, fromY=0, toX=0, toY=0,
                   fromScale=85, toScale=100, fromRotation=0, toRotation=0, fromOpacity=100, toOpacity=100, easing='smooth'),
    slide=dict(enabled=False, unit='percent', start=0, **{'in':15, 'out':15}, end=100, direction='right', distance=120),
    curves=dict(enabled=False, unit='percent', channels={}))
CHANNELS = dict(x=(-4096,4096), y=(-4096,4096), scale=(1,1000), rotation=(-360,360), opacity=(0,100))


def timings(name):
    return () if name == 'curves' else ('in', 'out') if name == 'fade' else ('start', 'end')


def valid_channels(raw, unit):
    if not isinstance(raw, dict):
        return False
    for key, points in raw.items():
        if key not in CHANNELS or not isinstance(points, list) or not 1 <= len(points) <= 32:
            return False
        for i, p in enumerate(points):
            if not isinstance(p, dict) or set(p) != {'time','value','easing'}:
                return False
            if any(type(p[k]) not in (int,float) or not math.isfinite(p[k]) for k in ('time','value')):
                return False
            if not (0 <= p['time'] <= (100 if unit == 'percent' else 60000)) or (i and p['time'] <= points[i-1]['time']):
                return False
            if not CHANNELS[key][0] <= p['value'] <= CHANNELS[key][1] or p['easing'] not in ('linear','smooth','hold'):
                return False
    return True


def valid(raw):
    if not isinstance(raw, dict) or not {'schema', 'effects'} <= set(raw) or set(raw)-{'schema','effects','mode'} or raw['schema'] != SCHEMA or not isinstance(raw['effects'], dict):
        return False
    if 'mode' in raw and raw['mode'] not in ('presets','custom'):
        return False
    for name, effect in raw['effects'].items():
        default = DEFINITIONS.get(name)
        extra = {'start','end'} if name == 'fade' else {'periodUnit'} if name == 'blink' else {'custom'} if name == 'typewriter' else set()
        if not default or not isinstance(effect, dict) or not set(default) <= set(effect) or set(effect)-set(default)-extra:
            return False
        if name == 'fade' and ('start' in effect) != ('end' in effect):
            return False
        for key, value in effect.items():
            if key in ('enabled','custom'):
                ok = type(value) is bool
            elif key == 'direction':
                ok = value in ('left','right','up','down')
            elif key in ('unit','periodUnit'):
                ok = value in ('percent', 'ms')
            elif key == 'easing':
                ok = value in ('linear', 'ease-in', 'ease-out', 'smooth')
            elif key == 'channels':
                ok = valid_channels(value, effect['unit'])
            else:
                low, high = ((0, 100 if effect['unit'] == 'percent' else 60000) if key in (*timings(name),'start','end', *(('in','out') if name=='slide' else ()))
                             else (0,4096) if key == 'distance'
                             else ((1,100) if effect.get('periodUnit') == 'percent' else (80,60000)) if key == 'period' else (0, 100) if key.endswith('Opacity') or key == 'opacity'
                             else (1, 1000) if key.endswith('Scale') else (-360, 360) if key.endswith('Rotation') else (-4096, 4096))
                ok = type(value) in (int, float) and math.isfinite(value) and low <= value <= high
            if not ok:
                return False
        if name not in ('fade','curves') and effect['end'] <= effect['start']:
            return False
        if name in ('fade','slide') and 'start' in effect and (effect['end'] <= effect['start'] or effect['in']+effect['out'] > effect['end']-effect['start']+1e-8):
            return False
    return True


def normalize(raw):
    if not valid(raw):
        raise ValueError('字幕动画参数无效')
    return dict(schema=SCHEMA, **({'mode':raw['mode']} if 'mode' in raw else {}), effects={**deepcopy(DEFINITIONS), **deepcopy(raw['effects'])})


def resolve(base=None, override=None):
    if base is None and override is None:
        return None
    mode = (override or {}).get('mode',(base or {}).get('mode'))
    return normalize(dict(schema=SCHEMA, **({'mode':mode} if mode else {}), effects={**(base or {}).get('effects', {}), **(override or {}).get('effects', {})}))


def active(raw):
    if 'mode' not in raw:
        return raw
    return {**raw, 'effects':{key:effect if ((key=='curves' or key=='typewriter' and effect.get('custom')) if raw['mode']=='custom' else key!='curves') else {**effect,'enabled':False}
                             for key,effect in raw['effects'].items()}}


def ms(effect, key, duration):
    return effect[key] * (duration / 100 if effect['unit'] == 'percent' else 1)


def clamp(value, low=0, high=1):
    return max(low, min(high, value))


def curve_value(points, time):
    if time <= points[0]['time']:
        return points[0]['value']
    for a, b in zip(points, points[1:]):
        if time < b['time']:
            p = (time-a['time'])/(b['time']-a['time'])
            p = 0 if a['easing'] == 'hold' else p*p*(3-2*p) if a['easing'] == 'smooth' else p
            return a['value']+(b['value']-a['value'])*p
    return points[-1]['value']


def sample(raw, elapsed, duration, count=0):
    raw = active(raw)
    f, w, b, t = (raw['effects'][key] for key in ('fade','typewriter','blink','transform'))
    time = clamp(elapsed, 0, duration)
    state = dict(opacity=1, x=0, y=0, scale=100, rotation=0, revealed=count)
    if f['enabled']:
        a, z = ms(f, 'in', duration), ms(f, 'out', duration)
        start = ms(f,'start',duration) if 'start' in f else 0
        end = ms(f,'end',duration) if 'end' in f else duration
        if a + z > end-start:
            ratio = (end-start) / (a + z)
            a *= ratio
            z *= ratio
        state['opacity'] = 0 if time<start or time>end else clamp(min((time-start) / a if a else 1, (end-time) / z if z else 1, 1))
    period = b['period']*(duration/100 if b.get('periodUnit')=='percent' else 1)
    if b['enabled'] and ms(b, 'start', duration) <= time < ms(b, 'end', duration) and math.floor((time-ms(b, 'start', duration))/(period/2)) % 2:
        state['opacity'] *= b['opacity']/100
    transform_opacity = 100
    if t['enabled']:
        p = clamp((time-ms(t, 'start', duration))/(ms(t, 'end', duration)-ms(t, 'start', duration)))
        p = p*p if t['easing'] == 'ease-in' else 1-(1-p)**2 if t['easing'] == 'ease-out' else p*p*(3-2*p) if t['easing'] == 'smooth' else p
        for key, suffix in [('x', 'X'), ('y', 'Y'), ('scale', 'Scale'), ('rotation', 'Rotation')]:
            state[key] = t['from'+suffix] + (t['to'+suffix]-t['from'+suffix])*p
        transform_opacity = t['fromOpacity']+(t['toOpacity']-t['fromOpacity'])*p
    s = raw['effects'].get('slide')
    if s and s['enabled']:
        start, end, a, z = (ms(s,key,duration) for key in ('start','end','in','out'))
        pin = clamp((time-start)/a) if a else int(time>=start)
        pout = clamp((time-end+z)/z) if z else int(time>=end)
        offset = -(1-pin*pin*(3-2*pin))+pout*pout*(3-2*pout)
        state['x' if s['direction'] in ('left','right') else 'y'] += offset*s['distance']*(-1 if s['direction'] in ('left','up') else 1)
    c = raw['effects'].get('curves')
    if c and c['enabled']:
        for key, points in c['channels'].items():
            value = curve_value(points, time*(100/duration if c['unit'] == 'percent' else 1))
            if key == 'opacity':
                transform_opacity = value
            else:
                state[key] = value
    state['opacity'] *= transform_opacity/100
    if w['enabled']:
        state['revealed'] = math.floor(clamp((time-ms(w, 'start', duration))/(ms(w, 'end', duration)-ms(w, 'start', duration)))*count+1e-7)
    return state


def boundaries(raw, duration, count):
    """Critical times plus bounded smooth interpolation; never a wall-clock timer."""
    raw = active(raw)
    cuts = {0, duration}
    for name, effect in raw['effects'].items():
        if not effect['enabled']:
            continue
        if name == 'curves':
            ratio = duration/100 if effect['unit'] == 'percent' else 1
            for points in effect['channels'].values():
                cuts.update(p['time']*ratio for p in points)
                for left, right in zip(points, points[1:]):
                    if left['easing'] != 'smooth':
                        continue
                    a, b = left['time']*ratio, min(duration, right['time']*ratio)
                    steps = math.ceil(max(0,b-a)/40)
                    if steps > 4096:
                        raise ValueError('字幕关键帧生成片段过多，请缩短动画时段')
                    cuts.update(a+i*40 for i in range(1,steps))
            continue
        if name in ('fade','slide'):
            a, z = ms(effect, 'in', duration), ms(effect, 'out', duration)
            start = ms(effect,'start',duration) if 'start' in effect else 0
            end = ms(effect,'end',duration) if 'end' in effect else duration
            ratio = min(1, (end-start)/(a+z)) if a+z else 1
            cuts.update((start,start+a*ratio,end-z*ratio,end))
            if name == 'slide':
                for lo, hi in ((start,start+a),(end-z,end)):
                    cuts.update(lo+i*40 for i in range(1,math.ceil(max(0,min(duration,hi)-lo)/40)))
            continue
        a, b = ms(effect, 'start', duration), ms(effect, 'end', duration)
        cuts.update((a, b))
        step = effect['period']*(duration/100 if effect.get('periodUnit')=='percent' else 1)/2 if name == 'blink' else (b-a)/max(1, count) if name == 'typewriter' else 40
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
    if raw['effects']['fade']['enabled'] and (raw['effects']['transform']['enabled'] or raw['effects'].get('curves',{}).get('enabled')):
        result = sorted(set(result) | {a+(b-a)*i/4 for a, b in zip(result, result[1:]) for i in (1, 2, 3)})
    if len(result) > 4096:
        raise ValueError('字幕动画生成片段过多，请减少效果或缩短动画时段')
    return result


def fragments(raw, text, style, duration, lo, hi, x, y, alignment, speaker_prefix='', speaker_color=None, *, drawing=None):
    """Yield source-relative fragments. Hidden text retains its original geometry."""
    from maw.subtitle_wrapping import _characters
    from maw.msw.subtitle_style import ass_text
    from maw.msw import subtitle_background as background
    from maw.msw import subtitle_gradient as gradient
    if drawing is not None:
        from copy import deepcopy
        raw = deepcopy(raw)
        raw['effects']['typewriter']['enabled'] = False
    units = _characters(text)
    count = sum(not unit.isspace() for unit in units)
    use_gradient=drawing is None and gradient.enabled(style)
    color_tags=[];color_index=0
    for unit in units:
        color_tags.append(gradient.tag(gradient.color(style,color_index,count)) if use_gradient and not unit.isspace() else '')
        if not unit.isspace():
            color_index+=1
    cuts = [lo] + [t for t in boundaries(raw, duration, count) if lo < t < hi] + [hi]
    def number(v):
        return f'{v:.4f}'.rstrip('0').rstrip('.') or '0'
    def alpha(v):
        return f'{math.floor(clamp(1-v)*255+.5):02X}'
    def props(state):
        opacity = state['opacity']*(background.normalize(style)['backgroundOpacity']/100 if drawing is not None else 1)
        return (rf'\fscx{number((100 if drawing is not None else style["scaleX"])*state["scale"]/100)}'
                rf'\fscy{number((100 if drawing is not None else style["scaleY"])*state["scale"]/100)}'
                rf'\frz{number(style["angle"]+state["rotation"])}\alpha&H{alpha(opacity)}&')
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
        tags = (background.tags(style) if drawing is not None else '')+rf'\an{alignment}\q2'+position+props(left)
        if props(left) != props(right):
            tags += r'\t(0,'+number(span)+',1,'+props(right)+')'
        if drawing is not None:
            yield a, b, tags, drawing
            continue
        parts, seen, prefix_count, hidden = [], 0, 0, False
        if speaker_color and speaker_prefix and not use_gradient:
            parts.append(color_tag(speaker_color))
        for unit_index, unit in enumerate(units):
            if not unit.isspace():
                seen += 1
            if seen > mid['revealed'] and not hidden:
                # Override the alpha transform for the invisible tail too.
                parts.append(r'{\alpha&HFF&\t(0,'+number(span)+r',1,\alpha&HFF&)}')
                hidden = True
            if speaker_color and speaker_prefix and prefix_count == len(speaker_prefix) and not use_gradient:
                parts.append(color_tag(style['primaryColor']))
                prefix_count += 1
            if color_tags[unit_index]:
                parts.append(color_tags[unit_index])
            parts.append(ass_text(unit))
            if unit != '\n':
                prefix_count += len(unit)
        yield a, b, tags, ''.join(parts)
