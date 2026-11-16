"""Paired subtitle markup, mirrored by web/msw-inline-markup.js.

Original cue text is never rewritten by rendering. Unknown/unpaired symbols
are literal, and all text still goes through the usual ASS escaping.
"""
MARKERS = ('**', '__', '~~', '--', '++', '%%', '//')


def enabled(project):
    return (project.get('preview') or {}).get('inline_markup') is True


def parse(value):
    source = str(value or '')
    tokens, escaped, stack, pairs = [], {}, [], []
    i = 0
    while i < len(source):
        if source[i] == '\\' and (source[i+1:i+3] in MARKERS or source[i+1:i+2] == '\\'):
            length = 2 if source[i+1:i+2] == '\\' else 3
            escaped[i] = length
            i += length
            continue
        marker = source[i:i+2]
        if (marker in MARKERS and (not i or source[i-1] != source[i])
                and source[i+2:i+3] != source[i] and not (marker == '//' and i and source[i-1] == ':')):
            tokens.append(dict(start=i, marker=marker))
            i += 2
        else:
            i += 1
    for token in tokens:
        last = stack[-1] if stack else None
        if (last and last['marker'] == token['marker'] and token['start'] > last['start']+2
                and source[last['start']+2:token['start']].strip()):
            pairs.append(dict(last, end=token['start']+2))
            stack.pop()
        elif not any(t['marker'] == token['marker'] for t in stack):
            stack.append(token)
    pairs.sort(key=lambda p: p['start'])
    opens = {p['start']: p for p in pairs}
    closes = {p['end']-2: p for p in pairs}
    runs, active, i = [], [], 0
    while i < len(source):
        if i in opens:
            active.append(opens[i]['marker'])
            i += 2
            continue
        if i in closes:
            active.remove(closes[i]['marker'])
            i += 2
            continue
        length = escaped.get(i, 1)
        text = source[i+1:i+length] if i in escaped else source[i]
        if runs and runs[-1]['marks'] == active:
            runs[-1]['text'] += text
        else:
            runs.append(dict(text=text, marks=list(active)))
        i += length
    return dict(text=''.join(r['text'] for r in runs), runs=runs, pairs=pairs)


def plain(text, on=True):
    return parse(text)['text'] if on else text


def appearance(base, marks):
    style, scale = dict(base), 1
    for mark in marks:
        if mark == '**':
            style.update(bold=True, primaryColor='#ffaa00')
            scale *= 1.3
        elif mark == '%%':
            style['primaryColor'] = '#999999'
            scale *= .8
        elif mark == '++':
            scale *= 1.5
        elif mark == '--':
            scale *= .8
        elif mark == '//':
            style['italic'] = True
        elif mark == '__':
            style['underline'] = True
        elif mark == '~~':
            style['strikeOut'] = True
    style['fontSize'] = base['fontSize']*scale
    return style


def graphemes(text, prefix=''):
    from maw.subtitle_wrapping import _characters
    runs = [dict(text=prefix,marks=[]), *parse(str(text).replace('\r\n','\n').replace('\r','\n'))['runs']]
    marks = [r['marks'] for r in runs for _ in r['text']]
    result, at = [], 0
    for unit in _characters(''.join(r['text'] for r in runs)):
        result.append((unit, marks[at]))
        at += len(unit)
    return result


def glyph_tags(text, style, marks, speaker_prefix='', speaker_color=None):
    """Full local state per grapheme; never reset positioning, alpha or motion."""
    from maw.subtitle_wrapping import _characters
    from maw.msw import subtitle_gradient as gradient
    units = _characters(text)
    count = sum(not u.isspace() for u in units)
    result, index, prefix_count = [], 0, 0
    for i, unit in enumerate(units):
        base = dict(style)
        if gradient.enabled(style):
            base['primaryColor'] = gradient.color(style, index, count)
        elif speaker_color and prefix_count < len(speaker_prefix):
            base['primaryColor'] = speaker_color
        local = appearance(base, marks[i])
        tags = rf'\fs{local["fontSize"]:.4f}'
        for field, tag in (('bold','b'),('italic','i'),('underline','u'),('strikeOut','s')):
            tags += '\\'+tag+str(int(bool(local.get(field))))
        result.append('{'+tags+'}'+gradient.tag(local['primaryColor']))
        if not unit.isspace():
            index += 1
        if unit != '\n':
            prefix_count += len(unit)
    return result


def ass(text, style, marks, speaker_prefix='', speaker_color=None):
    from maw.subtitle_wrapping import _characters
    from maw.msw.subtitle_fonts import font_tags
    from maw.msw.subtitle_style import ass_text
    units = _characters(text)
    tags = glyph_tags(text, style, marks, speaker_prefix, speaker_color)
    fonts = font_tags(units, style)
    result, previous = [], None
    for unit, local, font in zip(units, tags, fonts):
        result.append(('' if local == previous else local)+font+ass_text(unit))
        previous = local
    return ''.join(result)
