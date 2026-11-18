"""Local boundary checks: model text and guessed timing never become output."""

import re


def normalize_max_chars(value):
    if value in (None, ''):
        return 0
    if isinstance(value, bool) or not re.fullmatch(r'\d{1,4}', str(value)) or not 0 <= int(value) <= 1000:
        raise ValueError('重新断句最大字数须为 0–1000 的整数，0 表示不限制')
    return int(value)


def cue_response_as_atoms(response, cues):
    """Accept old cue protocols only when every cut maps to an original atom."""
    if not isinstance(response.get('groups'), list):
        raise ValueError('重新断句返回格式无效，未写出产物')
    if any('atom_ids' in group for group in response.get('groups', []) if isinstance(group, dict)):
        return response
    atoms = [(cue['id'], atom) for cue in cues for atom in cue['items']]
    groups, offset = [], 0
    for group in response.get('groups', []):
        if not isinstance(group, dict) or not isinstance(group.get('text'), str):
            raise ValueError('重新断句返回格式无效，未写出产物')
        ids = group.get('source_ids', [group.get('id')])
        text, selected, sources = '', [], []
        while offset < len(atoms) and len(text) < len(group['text']):
            source, atom = atoms[offset]
            text += atom['text']
            selected.append(atom['id'])
            if not sources or sources[-1] != source:
                sources.append(source)
            offset += 1
        if not selected or text != group['text'] or sources != ids:
            raise ValueError('重新断句改写了正文，或切点缺少可靠时间码，未写出产物')
        groups.append({'atom_ids': selected})
    if offset != len(atoms):
        raise ValueError('重新断句遗漏了原文，未写出产物')
    return {'groups': groups}


def safe_boundary(left, right):
    if re.search(r'[A-Za-z0-9]$', left) and re.match(r'[A-Za-z0-9]', right):
        return False
    if (re.search(r'\d\s*$', left) and re.match(r'\s*[.,:：/／]\s*\d', right)
            or re.search(r'\d\s*[.,:：/／]\s*$', left) and re.match(r'\s*\d', right)):
        return False
    if re.search(r'\d\s*°\s*$', left) and re.match(r'[CF](?![A-Za-z])', right, re.I):
        return False
    if re.search(r'\d[.,]?$', left.rstrip()) and re.match(
        r'[\d.%％℃℉]|°[CF](?![A-Za-z])|(?:公斤|千克|公里|千米|厘米|毫米|毫秒|分钟|小时|万元|亿元|毫升|升|像素|帧率|帧|元|秒|米|岁|个|年|月|日|天)'
        r'|(?:kg|g|km|m|mm|ms|s|min|h|ml|l|cm|px|fps|Hz|kHz|MHz|GB|MB|KB|TB|kbps|Mbps)(?![A-Za-z])',
        right.lstrip(), re.I,
    ):
        return False
    return True


def constrain_groups(groups, atoms, sources, coarse_sources, maximum=0, punctuation=()):
    """Keep coarse cues intact; constrain precise cuts without inventing times."""
    ids = [atom_id for group in groups for atom_id in group]
    texts = [atoms[identity]['text'] for identity in ids]
    joined = ''.join(texts)
    offsets = [0]
    for text in texts:
        offsets.append(offsets[-1] + len(text))
    mandatory, allowed = set(), {len(ids)}
    for position in range(1, len(ids)):
        left, right = ids[position-1], ids[position]
        source_changed = sources[left] != sources[right]
        if source_changed and (sources[left] in coarse_sources or sources[right] in coarse_sources
                               or atoms[left]['end'] > atoms[right]['start']):
            mandatory.add(position)
        offset = offsets[position]
        if position in mandatory or safe_boundary(joined[max(0, offset-32):offset], joined[offset:offset+32]):
            allowed.add(position)
    ends, position = set(mandatory), 0
    for group in groups:
        position += len(group)
        if position in allowed:
            ends.add(position)
    ends.add(len(ids))
    output, warnings, start = [], [], 0
    for end in sorted(ends):
        while maximum and sum(not char.isspace() for char in ''.join(texts[start:end])) > maximum:
            candidates, length = [], 0
            for cut in range(start+1, end+1):
                length += sum(not char.isspace() for char in texts[cut-1])
                if length > maximum:
                    break
                if cut in allowed:
                    candidates.append(cut)
            if not candidates:
                # One indivisible word/quantity or a coarse cue exceeds the limit.
                cut = next((cut for cut in range(start+1, end+1) if cut in allowed), end)
                warnings.append(f'完整词项、数字单位或缺少字词时间码的字幕超过最大 {maximum} 字，已保留原文与时间，请人工复核。')
            else:
                preferred = [cut for cut in candidates if texts[cut-1].rstrip()[-1:] in punctuation]
                cut = preferred[-1] if preferred else candidates[-1]
            output.append(tuple(ids[start:cut]))
            start = cut
        if start < end:
            output.append(tuple(ids[start:end]))
        start = end
    return output, tuple(dict.fromkeys(warnings))
