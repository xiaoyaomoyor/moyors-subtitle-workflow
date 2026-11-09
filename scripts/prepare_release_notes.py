"""Build one consistent GitHub Release body from the matching changelog section."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def extract_release_section(changelog: str, tag: str) -> str:
    """Return the changelog section for *tag*, excluding later releases."""
    normalized_tag = tag.strip()
    if not normalized_tag.startswith("v"):
        raise ValueError(f"release tag must start with v: {tag!r}")
    version = normalized_tag[1:]
    pattern = re.compile(
        r"(?ms)^## \[%s\][^\r\n]*\r?\n.*?(?=^## \[|\Z)" % re.escape(version)
    )
    match = pattern.search(changelog)
    if not match:
        raise ValueError(f"CHANGELOG.md does not contain a release section for {version}.")
    return match.group(0).strip()


def build_release_notes(changelog: str, tag: str) -> str:
    """Build the shared download and usage guide followed by release notes."""
    guide = f"""## 下载哪个版本？

**默认下载 `MSW`** ： 内置 FFmpeg；已有 FFmpeg 可选体积更小的 `MSW-lite`。

| 平台 | 标准版 | lite 版 |
| --- | --- | --- |
| Windows x64 | `MSW-Windows-x64-{tag}.zip` | `MSW-lite-Windows-x64-{tag}.zip` |
| macOS Apple Silicon | `MSW-macOS-arm64-{tag}.zip` | `MSW-lite-macOS-arm64-{tag}.zip` |
| Linux x86_64 | `MSW-Linux-x86_64-{tag}.AppImage` | — |

GitHub 自动附带的 Source code ZIP / tar.gz 是源码，普通用户请选择上面的安装包。
云端服务需要自己的 API Key 和额度；本机模型与可选配音资源另行配置。

## 如何使用

解压后打开 `MSW.exe` / `MSW.app`；Linux 为 AppImage 添加执行权限后运行。可直接启动编辑器（`--editor`），启动器仍可批量转写、生成工程。
服务连接位于「编辑 → 编辑器设置 → 服务与环境」；工程轨道和说话人位于「项目设置」。

[完整使用文档](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/WORKFLOW.md) · [安装与升级](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/INSTALLATION.md) · [常见问题](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/FAQ.md)
"""
    section = extract_release_section(changelog, tag)
    section = re.sub(r'\]\((docs/[^)]+)\)',
                     lambda match: f'](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/{match.group(1)})', section)
    return guide.strip() + "\n\n" + section + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True, help="release tag, for example v1.4.0-beta.6")
    parser.add_argument("--output", type=Path, required=True, help="output Markdown path")
    args = parser.parse_args()

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    notes = build_release_notes(changelog, args.tag)
    args.output.write_bytes(notes.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
