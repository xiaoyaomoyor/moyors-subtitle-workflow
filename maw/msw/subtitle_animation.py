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
    wave=dict(enabled=False, unit='percent', start=0, end=100, amplitude=12, period=40, periodUnit='percent', wavelength=8, direction='right'),
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
            if not isinstance(p, dict) or not {'time','value','easing'} <= set(p) or set(p)-{'time','value','easing','anchor'} or p.get('anchor','start') not in ('start','end'):
                return False
            if any(type(p[k]) not in (int,float) or not math.isfinite(p[k]) for k in ('time','value')):
                return False
            if not (0 <= p['time'] <= (100 if unit == 'percent' else 60000)) or (i and point_order(p) <= point_order(points[i-1])):
                return False
            if not CHANNELS[key][0] <= p['value'] <= CHANNELS[key][1] or p['easing'] not in ('linear','smooth','hold'):
                return False
    return True


def valid(raw):
    if not isinstance(raw, dict) or not {'schema', 'effects'} <= set(raw) or set(raw)-{'schema','effects','mode','timing'} or raw['schema'] != SCHEMA or not isinstance(raw['effects'], dict):
        return False
    if 'mode' in raw and raw['mode'] not in ('presets','custom'):
        return False
    if 'timing' in raw and raw['timing'] not in ('percent','ms'):
        return False
    for name, effect in raw['effects'].items():
        default = DEFINITIONS.get(name)
        extra = {'start','end'} if name == 'fade' else {'periodUnit'} if name == 'blink' else {'custom'} if name == 'typewriter' else set()
        extra |= {'pulse'} if name == 'curves' else {'endAnchor'}
        if not default or not isinstance(effect, dict) or not set(default) <= set(effect) or set(effect)-set(default)-extra:
            return False
        if name == 'fade' and ('start' in effect) != ('end' in effect):
            return False
        for key, value in effect.items():
            if key in ('enabled','custom'):
                ok = type(value) is bool
            elif key == 'direction':
                ok = value in (('left','right') if name == 'wave' else ('left','right','up','down'))
            elif key in ('unit','periodUnit'):
                ok = value in ('percent', 'ms')
            elif key == 'easing':
                ok = value in ('linear', 'ease-in', 'ease-out', 'smooth')
            elif key == 'channels':
                ok = valid_channels(value, effect['unit'])
            elif key == 'endAnchor':
                ok = value in ('start','end') and 'end' in effect
            elif key == 'pulse':
                ok = valid(dict(schema=SCHEMA,effects=dict(blink=value)))
            else:
                low, high = ((0, 100 if effect['unit'] == 'percent' else 60000) if key in (*timings(name),'start','end', *(('in','out') if name=='slide' else ()))
                             else (0,120) if key == 'amplitude' else (2,64) if key == 'wavelength'
                             else (0,4096) if key == 'distance'
                             else (((5 if name=='wave' else 1),100) if effect.get('periodUnit') == 'percent' else ((200 if name=='wave' else 80),60000)) if key == 'period' else (0, 100) if key.endswith('Opacity') or key == 'opacity'
                             else (1, 1000) if key.endswith('Scale') else (-360, 360) if key.endswith('Rotation') else (-4096, 4096))
                ok = type(value) in (int, float) and math.isfinite(value) and low <= value <= high
            if not ok:
                return False
        if effect.get('endAnchor') == 'end':
            continue
        if name not in ('fade','curves') and effect['end'] <= effect['start']:
            return False
        if name in ('fade','slide') and 'start' in effect and (effect['end'] <= effect['start'] or effect['in']+effect['out'] > effect['end']-effect['start']+1e-8):
            return False
    return True


def normalize(raw):
    if not valid(raw):
        raise ValueError('字幕动画参数无效')
    return dict(schema=SCHEMA, **{k:raw[k] for k in ('mode','timing') if k in raw}, effects={**deepcopy(DEFINITIONS), **deepcopy(raw['effects'])})


def resolve(base=None, override=None):
    if base is None and override is None:
        return None
    options = {k:(override or {}).get(k,(base or {}).get(k)) for k in ('mode','timing')}
    return normalize(dict(schema=SCHEMA, **{k:v for k,v in options.items() if v}, effects={**(base or {}).get('effects', {}), **(override or {}).get('effects', {})}))


def active(raw):
    if 'mode' not in raw:
        return raw
    return {**raw, 'effects':{key:effect if ((key in ('curves','wave') or key=='typewriter' and effect.get('custom')) if raw['mode']=='custom' else key!='curves') else {**effect,'enabled':False}
                             for key,effect in raw['effects'].items()}}


def ms(effect, key, duration):
    return effect[key] * (duration / 100 if effect['unit'] == 'percent' else 1)


def clamp(value, low=0, high=1):
    return max(low, min(high, value))


def point_order(point):
    return (1, -point['time']) if point.get('anchor') == 'end' else (0, point['time'])


def clock_effect(effect, duration):
    n = deepcopy(effect)
    if not effect.get('endAnchor'):
        return n
    start, finish = (ms(effect,k,duration) for k in ('start','end'))
    a, z = (ms(effect,k,duration) if k in effect else 0 for k in ('in','out'))
    extent = start+a+finish+z if effect['endAnchor']=='end' else max(finish,start+a+z)
    ratio = min(1,duration/max(extent,1e-9))
    n.update(unit='ms',start=start*ratio,end=duration-finish*ratio if effect['endAnchor']=='end' else finish*ratio)
    for key in ('in','out'):
        if key in n:
            n[key]=ms(effect,key,duration)*ratio
    if 'in' not in effect and n['end']<=n['start']:
        n['end']=n['start']+1e-7
    del n['endAnchor']
    return n


def resolve_points(points, unit, duration):
    factor = duration/100 if unit=='percent' else 1
    extent = sum(max([p['time'] for p in points if p.get('anchor','start')==side] or [0]) for side in ('start','end'))
    ratio = min(1,duration/max(1e-9,extent*factor)) if any('anchor' in p for p in points) else 1
    result=[]
    for p in points:
        time = duration-p['time']*factor*ratio if p.get('anchor')=='end' else p['time']*factor*ratio
        n={k:v for k,v in p.items() if k!='anchor'}
        n['time']=time
        result.append(n)
    return result


def runtime(raw, duration):
    effects={key:clock_effect(e,duration) if e.get('endAnchor') else e for key,e in raw['effects'].items()}
    c=effects.get('curves')
    if c and c['enabled']:
        effects['curves']={**c,'unit':'ms','channels':{key:resolve_points(p,c['unit'],duration) for key,p in c['channels'].items()}}
        if c.get('pulse'):
            effects['blink']=clock_effect(c['pulse'],duration)
    return {**raw,'effects':effects}


def curve_value(points, time):
    if time < points[0]['time']:
        return points[0]['value']
    for a, b in zip(points, points[1:]):
        if time < b['time']:
            p = (time-a['time'])/(b['time']-a['time'])
            p = 0 if a['easing'] == 'hold' else p*p*(3-2*p) if a['easing'] == 'smooth' else p
            return a['value']+(b['value']-a['value'])*p
    return points[-1]['value']


def sample(raw, elapsed, duration, count=0):
    raw = runtime(active(raw), duration)
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


def wave_offset(effect, elapsed, duration, index):
    """Screen-space vertical offset. Character phase restarts on each line."""
    if not effect or not effect['enabled'] or not effect['amplitude']:
        return 0
    e = clock_effect(effect, duration)
    start, end = (ms(e, key, duration) for key in ('start', 'end'))
    if elapsed <= start or elapsed >= end:
        return 0
    period = e['period']*(duration/100 if e['periodUnit']=='percent' else 1)
    ramp = min(period/4, (end-start)/2)
    p = clamp(min(elapsed-start, end-elapsed)/max(ramp, 1e-9))
    return e['amplitude']*p*p*(3-2*p)*math.sin(2*math.pi*(index/e['wavelength']+(1 if e['direction']=='left' else -1)*(elapsed-start)/period))


def boundaries(raw, duration, count):
    """Critical times plus bounded smooth interpolation; never a wall-clock timer."""
    raw = runtime(active(raw), duration)
    cuts = {0, duration}
    for name, effect in raw['effects'].items():
        if not effect['enabled']:
            continue
        if name == 'wave' and not effect['amplitude']:
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
        if name == 'wave':
            period = effect['period']*(duration/100 if effect['periodUnit']=='percent' else 1)
            step = max(10, min(40, period/16))
            ramp = min(period/4, (b-a)/2)
            cuts.update((a+ramp, b-ramp))
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


def fragments(raw, text, style, duration, lo, hi, x, y, alignment, speaker_prefix='', speaker_color=None, *, drawing=None, align_offset=0):
    """Yield source-relative fragments. Hidden text retains its original geometry."""
    from maw.subtitle_wrapping import _characters
    from maw.msw.subtitle_style import ass_text
    from maw.msw import subtitle_background as background
    from maw.msw import subtitle_gradient as gradient
    if drawing is not None:
        from copy import deepcopy
        raw = deepcopy(raw)
        raw['effects']['typewriter']['enabled'] = False
        raw['effects']['wave']['enabled'] = False
    units = _characters(text)
    from maw.msw.subtitle_fonts import font_tags
    fonts = font_tags(units, style)
    count = sum(not unit.isspace() for unit in units)
    use_gradient=drawing is None and gradient.enabled(style)
    color_tags=[];color_index=0
    for unit in units:
        color_tags.append(gradient.tag(gradient.color(style,color_index,count)) if use_gradient and not unit.isspace() else '')
        if not unit.isspace():
            color_index+=1
    cuts = [lo] + [t for t in boundaries(raw, duration, count) if lo < t < hi] + [hi]
    wave = runtime(active(raw), duration)['effects'].get('wave')
    waving = wave and wave['enabled'] and wave['amplitude'] > 0
    if waving:
        wave_start, wave_end = (ms(wave, key, duration) for key in ('start', 'end'))
        segments = sum(b > wave_start and a < wave_end for a, b in zip(cuts, cuts[1:]))
        if segments and (count > 128 or segments*count > 16000):
            raise ValueError('文字波动生成片段过多，请缩短波动区间、拆分长句或减小使用范围（每条最多 128 字／16000 片段）')
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
        def tags_at(dy_left=0, dy_right=0):
            xy = [x+left['x'], y+left['y']+dy_left, x+right['x'], y+right['y']+dy_right]
            if align_offset:
                for index, state in ((0, left), (2, right)):
                    angle = math.radians(style['angle']+state['rotation'])
                    offset = align_offset*state['scale']/100
                    xy[index] += offset*math.cos(angle)
                    xy[index+1] -= offset*math.sin(angle)
            movement = abs(xy[0]-xy[2]) > 1e-6 or abs(xy[1]-xy[3]) > 1e-6
            position = ('\\move('+','.join(number(v) for v in [*xy, 0, span])+')' if movement
                        else '\\pos('+','.join(number(v) for v in xy[:2])+')')
            tags = (background.tags(style) if drawing is not None else '')+rf'\an{alignment}\q2'+position+props(left)
            if props(left) != props(right):
                tags += r'\t(0,'+number(span)+',1,'+props(right)+')'
            return tags
        tags = tags_at()
        if drawing is not None:
            yield a, b, tags, drawing
            continue
        if waving and a < wave_end and b > wave_start:
            # Keep the complete shaped line in every event, masking everything
            # except one grapheme. No guessed advances or lost spaces/kerning.
            # Alpha overrides must cancel the event's fade on the hidden text.
            invisible = r'{\alpha&HFF&\t(0,'+number(span)+r',1,\alpha&HFF&)}'
            visible = r'{\alpha&H'+alpha(left['opacity'])+r'&\t(0,'+number(span)+r',1,\alpha&H'+alpha(right['opacity'])+'&)}'
            tokens, targets, seen, phase, prefix_count = [], [], 0, 0, 0
            current_color = speaker_color if speaker_prefix and speaker_color else style['primaryColor']
            for j, unit in enumerate(units):
                if speaker_color and speaker_prefix and prefix_count >= len(speaker_prefix):
                    current_color = style['primaryColor']
                tokens.append((color_tags[j] or color_tag(current_color))+fonts[j]+ass_text(unit))
                if not unit.isspace():
                    seen += 1
                    if seen <= mid['revealed']:
                        targets.append((j, phase))
                    phase += 1
                if unit == '\n':
                    phase = 0
                else:
                    prefix_count += len(unit)
            # Opaque ASS boxes stay as one unbroken background. Custom drawn
            # backgrounds already have their own independent stream.
            box = style['borderStyle'] == 3
            if box:
                yield a, b, tags+r'\1a&HFF&\2a&HFF&\t(0,'+number(span)+r',1,\1a&HFF&\2a&HFF&)', ''.join(tokens)
                visible = (r'{\alpha&H'+alpha(left['opacity'])+r'&\3a&HFF&\4a&HFF&\t(0,'+number(span)
                           +r',1,\alpha&H'+alpha(right['opacity'])+r'&\3a&HFF&\4a&HFF&)}')
            for j, phase in targets:
                body = invisible+''.join(tokens[:j])+visible+tokens[j]+invisible+''.join(tokens[j+1:])
                wave_tags = tags_at(wave_offset(wave, a, duration, phase), wave_offset(wave, b, duration, phase))
                if box:
                    wave_tags += r'\bord0\shad0'
                yield a, b, wave_tags, body
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
            parts.append(fonts[unit_index]+ass_text(unit))
            if unit != '\n':
                prefix_count += len(unit)
        yield a, b, tags, ''.join(parts)
