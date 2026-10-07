"""Render-only character wrapping; mirrored by MSWProjectStyle in the browser."""
import unicodedata


def normalize_wrapping(raw):
    mode = raw.get('wrapMode', 'auto')
    count = raw.get('charsPerLine', 20)
    if mode not in ('auto', 'characters'):
        raise ValueError('字幕换行方式无效')
    if type(count) is not int or not 1 <= count <= 200:
        raise ValueError('每行字数必须是 1–200 的整数')
    return dict(wrapMode=mode, charsPerLine=count)


def _characters(text):
    # Keep combining marks, emoji modifiers, ZWJ sequences and flag pairs intact.
    units, regional = [], 0
    for char in text:
        code = ord(char)
        flag = 0x1F1E6 <= code <= 0x1F1FF
        attached = (unicodedata.category(char).startswith('M') or char == '\u200d'
                    or 0x1F3FB <= code <= 0x1F3FF or 0xE0020 <= code <= 0xE007F)
        if units and (attached or units[-1].endswith('\u200d') or flag and regional % 2):
            units[-1] += char
        else:
            units.append(char)
        regional = regional + 1 if flag else 0
    return units


def wrap_text(text, style):
    text = str(text or '')
    if style.get('wrapMode', 'auto') != 'characters':
        return text
    count = normalize_wrapping(style)['charsPerLine']
    lines = []
    for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        units = _characters(line)
        lines.extend(''.join(units[i:i+count]) for i in range(0, len(units), count))
        if not units:
            lines.append('')
    return '\n'.join(lines)


def wrap_cues(cues, style):
    if style.get('wrapMode', 'auto') != 'characters':
        return cues
    return [dict(cue, text=wrap_text(cue.get('text', ''), style)) for cue in cues]


def render_project(project, style):
    result = dict(project, segments=wrap_cues(project.get('segments', []), style['main']))
    multi = project.get('multi_subtitle')
    if multi and multi.get('tracks'):
        result['multi_subtitle'] = dict(multi, tracks=[
            dict(track, segments=wrap_cues(track.get('segments', []), style['secondary']))
            for track in multi['tracks']])
    return result
