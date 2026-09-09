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

**默认下载 `MSW`** ： 它内置了我们需要的 `ffmpeg` 和 `ffprobe`，解压即用。
**如果你本机环境装有 `ffmpeg`** ： 可以选择体积更小的 `MSW-lite` 版本。

| 平台 | 标准版 | lite 版 |
| --- | --- | --- |
| Windows x64 | `MSW-Windows-x64-{tag}.zip` | `MSW-lite-Windows-x64-{tag}.zip` |
| macOS Apple Silicon | `MSW-macOS-arm64-{tag}.zip` | `MSW-lite-macOS-arm64-{tag}.zip` |
| Linux x86_64 | `MSW-Linux-x86_64-{tag}.AppImage` | — |

GitHub 自动附带的 Source code ZIP / tar.gz 是源码，普通用户请选择上面的安装包。
标准版内置媒体工具，不包含 API Key、云端额度或大型模型；油库里资源与 IndexTTS 服务另行配置。

## 如何使用

1. 下载安装包后解压
2. 双击对应的 `MSW` 可执行文件，打开启动器
3. 在启动器中，可以执行字幕转写、生成工程等操作
4. 完成后，启动字幕编辑器，进行字幕精修
5. 翻译和 TTS 连接在编辑器「全局设置 → 环境配置」中管理，音频可放入时间轴并导出
6. 升级前备份 `.mosp`、`.assets` 和原媒体；预发布版建议保留旧版以便回退

详细文档参阅：[完整使用文档](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/WORKFLOW.md)
环境和安装参阅：[可选环境](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/ENVIRONMENT.md)、[安装与升级](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/INSTALLATION.md)
遇到问题可以参见：[常见问题](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/{tag}/docs/FAQ.md)
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
