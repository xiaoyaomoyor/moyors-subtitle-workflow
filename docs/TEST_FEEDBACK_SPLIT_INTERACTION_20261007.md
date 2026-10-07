# 切分确认与快捷键细节（2026-10-07）

- 基线 `a89be3f`，工作分支 `my-feature`；保留 `.test-appdata/`、`output/`。
- 本轮授权：确认区波形切点可拖动；卡片快速切分遵循已显示的虚线；上下键／鼠标切换操作轨并持续高亮；统一提示 icon；新增 Shift+B 独立切分并解绑。验证后提交推送。
- 不重启用户服务、不修改用户工程。上一轮综合浏览器测试的 27 项既有失败见 `TEST_FEEDBACK_SPLIT_SHORTCUTS_THEME_20261007.md`，本轮只回归相关交互，不重复运行已确认无关的失败。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 卡片切点、当前轨与快捷键 | 已修复 | 快速切分读取已显示的卡片切点及文字边界；波形入口仍取指针时间。上下键／鼠标选轨持续高亮，Shift+B 独立切高亮轨并解绑，一次撤销恢复。31 项相关浏览器用例通过（首轮 30 项，输入保护断言纠正为允许正常输入字母后复验 1 项）。 |
| 确认区波形切点拖动 | 已修复 | 联动确认时启用虚线拖动；只改草稿，两轨同一切点并重新估算文字分界，保证两侧各 100ms。真实拖动的跨行、取消、工程切换、画布复用、播放头不变及一次撤销共 3 项通过。 |
| 提示 icon 与说明 | 已修复 | 复用 `MSWHelp` 的 SVG icon、悬停／聚焦显示、点击固定、Esc 关闭行为；移除旧原生 title 长说明。帮助面板与确认区显示 Shift+B，中英文同步。完整切分专项 37 项通过，包含提示浮层与高亮的实际交互。 |
| 回归、便携产物与交付 | 已修复 | 本轮相关浏览器 79 项、Node 353 项和全量 Python 均通过；已更新便携编辑器、说明和 changelog。交付分支为 `my-feature`，具体提交见 Git 历史。 |

## 最终验证

- `node --check web/editor.js`、`web/waveform.js`、`web/editor-i18n.js`：通过。
- `node --test tests/test_editor_utils.mjs tests/test_subtitle_layers.mjs tests/test_project_style.mjs tests/test_waveform_js.mjs`：353 项通过。
- `python -m unittest discover -s tests -p 'test_*.py'`：2018 项，跳过 25 项，其余通过；使用隔离配置与测试数据目录。
- Playwright `split-inline.spec.mjs`：37 项通过，覆盖主副卡片与波形的 Ctrl+B／Shift+B、持续操作轨高亮、左右文字／上下选轨、拖动跨行与最小时长、撤回拖动／取消／工程切换、单次撤销重做、共享提示 icon 和中英文。
- `multi-subtitle.spec.mjs`、`waveform-history.spec.mjs` 中匹配 `split|splitting|both lanes adjust|help reflects|contextual help` 的相关旧交互：37 项通过。首轮 36 项通过，1 项仍断言已移除的原生 `title`；改为检查实际切点与可拖动状态后专项复验通过。
- `split-subtitle-preview.spec.mjs`：5 项通过，确保切分后工程数据及精确字幕预览有效。上述为 79 个不同的浏览器用例；并未将整个浏览器套件报告为全绿。
- `uv run python edit.py --blank`、`git diff --check`：通过；本轮文本文件均为 UTF-8／LF。
- 已检查确认区高亮、提示浮层和窄屏布局截图；截图、日志与测试媒体不纳入提交。未重启用户服务或改动用户工程。

拖动期间使用独立的草稿状态和稳定的波形容器接收指针，行重建后仍可继续；松手不写入工程，点击确认才形成一次可撤销的切分。拖动中按 Esc 或丢失指针会恢复拖动前的草稿；文字微调本身不会移动切分时间。
