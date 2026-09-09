"""Validate the five MSW release downloads before any public upload."""
from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

PACKAGES = {
    'windows': ('MSW-Windows-x64-{tag}.zip', 'MSW-lite-Windows-x64-{tag}.zip'),
    'macos': ('MSW-macOS-arm64-{tag}.zip', 'MSW-lite-macOS-arm64-{tag}.zip'),
    'linux': ('MSW-Linux-x86_64-{tag}.AppImage',),
}


def expected_names(tag: str, platform: str = 'all') -> set[str]:
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', tag):
        raise ValueError('Expected a version tag such as v1.6.0-beta.1')
    platforms = PACKAGES if platform == 'all' else {platform: PACKAGES[platform]}
    return {name.format(tag=tag) for names in platforms.values() for name in names}


def check_zip(path: Path) -> None:
    with ZipFile(path) as archive:
        names = [name.replace('\\', '/') for name in archive.namelist()]
        for name in names:
            parts = PurePosixPath(name).parts
            if name.startswith('/') or '..' in parts or re.match(r'^[A-Za-z]:', name):
                raise ValueError(f'{path.name}: unsafe archive path')
            if any(part in {'.env', '.git', '__pycache__', 'node_modules'} for part in parts):
                raise ValueError(f'{path.name}: unexpected private/cache file {name}')
        if archive.testzip():
            raise ValueError(f'{path.name}: ZIP CRC check failed')
        executable = 'MSW.exe' if 'Windows' in path.name else 'Contents/MacOS/MSW'
        required = (executable, 'README-开始使用.txt', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
                    'FAQ-常见问题.txt', 'web/launcher/logo.svg', 'web/favicon.svg',
                    'maw/msw/yukkuri_worker.mjs', 'maw/msw/yukkuri_resources.json')
        for suffix in required:
            if not any(name == suffix or name.endswith('/' + suffix) for name in names):
                raise ValueError(f'{path.name}: missing {suffix}')
        executable_names = {PurePosixPath(name).name for name in names}
        ffmpeg = {'ffmpeg.exe', 'ffprobe.exe'} if 'Windows' in path.name else {'ffmpeg', 'ffprobe'}
        if '-lite-' in path.name:
            if executable_names & ffmpeg:
                raise ValueError(f'{path.name}: lite package unexpectedly includes FFmpeg')
        elif not ffmpeg <= executable_names:
            raise ValueError(f'{path.name}: standard package must include ffmpeg and ffprobe')


def check_release(directory: Path, tag: str, platform: str = 'all') -> list[tuple[str, str]]:
    expected = expected_names(tag, platform)
    found = {path.name for path in directory.iterdir()}
    if expected != found:
        raise ValueError(f'Package set mismatch: missing={sorted(expected-found)}, unexpected={sorted(found-expected)}')
    digests = []
    for name in sorted(expected):
        path = directory / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            raise ValueError(f'{name}: not a regular non-empty package')
        if path.suffix == '.zip':
            check_zip(path)
        else:
            with path.open('rb') as stream:
                header = stream.read(20)
            if header[:5] != b'\x7fELF\x02' or header[8:11] != b'AI\x02' or header[18:20] != b'\x3e\x00':
                raise ValueError(f'{name}: expected an x86_64 Type 2 AppImage')
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        digests.append((name, digest))
    return digests


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--platform', choices=['all', *PACKAGES], default='all')
    parser.add_argument('--notes', type=Path, help='Append SHA-256 values to release notes, without adding an extra asset')
    args = parser.parse_args()
    digests = check_release(args.directory, args.tag, args.platform)
    if args.notes:
        table = '\n\n## SHA-256\n\n| 文件 | SHA-256 |\n| --- | --- |\n'
        table += ''.join(f'| `{name}` | `{digest}` |\n' for name, digest in digests)
        args.notes.write_bytes(args.notes.read_bytes() + table.encode('utf-8'))
    print(f'Validated {len(digests)} packages for {args.tag}.')


if __name__ == '__main__':
    main()
