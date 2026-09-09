"""Create portable UTF-8 release ZIPs while preserving macOS bundle symlinks."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import stat
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def create_zip(directory: Path, output: Path) -> None:
    directory = directory.resolve(strict=True)
    output = output.resolve()
    if not directory.is_dir() or output.is_relative_to(directory):
        raise ValueError('Output must be outside the source directory')
    with ZipFile(output, 'w', compression=ZIP_DEFLATED, strict_timestamps=False) as archive:
        for parent, directories, files in os.walk(directory, followlinks=False):
            directories.sort()
            for name in sorted([*directories, *files]):
                path = Path(parent) / name
                relative = path.relative_to(directory).as_posix()
                if path.is_symlink():
                    target = os.readlink(path)
                    if Path(target).is_absolute() or not path.resolve().is_relative_to(directory):
                        raise ValueError(f'Bundle symlink escapes source directory: {relative}')
                    info = ZipInfo(relative)
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | stat.S_IMODE(path.lstat().st_mode)) << 16
                    info.compress_type = ZIP_DEFLATED
                    archive.writestr(info, target.encode('utf-8'))
                else:
                    archive.write(path, relative)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    create_zip(args.directory, args.output)


if __name__ == '__main__':
    main()
