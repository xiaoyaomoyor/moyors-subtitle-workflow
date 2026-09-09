from __future__ import annotations

import unittest

from scripts.prepare_release_notes import build_release_notes, extract_release_section


class ReleaseNotesTests(unittest.TestCase):
    def test_extracts_only_the_requested_release_section(self) -> None:
        changelog = """## [1.0.0] - today

### 🐛 问题修复

- current

## [0.9.0] - yesterday

- older
"""

        section = extract_release_section(changelog, "v1.0.0")

        self.assertIn("- current", section)
        self.assertNotIn("- older", section)

    def test_builds_shared_download_and_usage_guide(self) -> None:
        notes = build_release_notes("## [1.0.0] - today\n\n### ✨ 新增\n\n- feature\n", "v1.0.0")

        self.assertIn("## 下载哪个版本？", notes)
        self.assertIn("默认下载 `MSW`", notes)
        self.assertIn("MSW-lite", notes)
        self.assertNotIn("### 📦", notes)
        self.assertIn("## 如何使用", notes)
        self.assertIn("1. 下载安装包后解压", notes)
        self.assertIn("2. 双击对应的 `MSW` 可执行文件，打开启动器", notes)
        self.assertIn("3. 在启动器中，可以执行字幕转写、生成工程等操作", notes)
        self.assertIn("4. 完成后，启动字幕编辑器，进行字幕精修", notes)
        self.assertIn("[完整使用文档](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/v1.0.0/docs/WORKFLOW.md)", notes)
        self.assertIn("[常见问题](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/v1.0.0/docs/FAQ.md)", notes)
        self.assertIn('MSW-Linux-x86_64-v1.0.0.AppImage', notes)
        self.assertNotIn('blob/main/', notes)
        self.assertIn("### ✨ 新增", notes)

    def test_rejects_non_tag_input(self) -> None:
        with self.assertRaisesRegex(ValueError, "must start with v"):
            extract_release_section("## [1.0.0]\n", "1.0.0")

    def test_changelog_links_are_pinned_to_the_released_fork_tag(self) -> None:
        notes = build_release_notes('## [1.0.0]\n\n[环境](docs/ENVIRONMENT.md)\n', 'v1.0.0')
        self.assertNotIn('](docs/', notes)
        self.assertIn('/moyors-subtitle-workflow/blob/v1.0.0/docs/ENVIRONMENT.md', notes)


if __name__ == "__main__":
    unittest.main()
