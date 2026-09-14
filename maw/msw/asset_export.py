"""Export an explicit selection of verified audio resources, without a project."""
from contextlib import contextmanager
import hashlib
import re
import tempfile
import zipfile
from maw.msw.project_codec import valid_id

MAX_BYTES = 512 * 1024 * 1024


@contextmanager
def selected_audio_zip(api, project_id, ids):
    if (not valid_id(project_id) or not isinstance(ids, list) or not 0 < len(ids) <= 10000
            or any(not valid_id(value) for value in ids)):
        raise ValueError('请选择当前工程中的音频素材（最多 10000 条）')
    rows, failures, total = [], [], 0
    for asset_id in dict.fromkeys(ids):
        asset, owner = api.asset_reference(project_id, asset_id)
        if not asset:
            failures.append(asset_id)
            continue
        generation = asset.get('generation') or {}
        label = generation.get('filename') or generation.get('display_text') or asset_id
        try:
            path = api.assets.resolve(project_id, asset, owner)
        except (FileNotFoundError, ValueError):
            failures.append(label)
            continue
        total += asset['byte_size']
        if total > MAX_BYTES:
            raise ValueError('所选音频超过 512 MiB，请分批导出')
        label = re.sub(r'\.\w{1,5}$', '', label) if generation.get('filename') else label
        label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', label).strip(' .')[:60] or 'audio'
        rows.append((asset, path, f'{len(rows)+1:04d}-{label}.wav'))
    if failures:
        raise ValueError('素材缺失或内容已变化，未导出：' + '、'.join(failures))
    with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as stream:
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_STORED) as archive:
            for asset, path, name in rows:
                digest, size = hashlib.sha256(), 0
                with path.open('rb') as source, archive.open(name, 'w') as target:
                    while chunk := source.read(1024 * 1024):
                        size += len(chunk)
                        if size > asset['byte_size']:
                            raise ValueError('音频在导出期间已变化，请重试')
                        digest.update(chunk)
                        target.write(chunk)
                if size != asset['byte_size'] or digest.hexdigest() != asset['sha256']:
                    raise ValueError('音频在导出期间已变化，请重试')
        size = stream.tell()
        stream.seek(0)
        yield stream, size
