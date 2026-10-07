# 切割工具与确认区设置（2026-10-07）

- 基线 `bac26e2`，分支 `my-feature`；保留本机 `.test-appdata/`、`output/`。
- 已确认：切割工具 Ctrl 点击快速联动切分，Shift 点击仅切所点字幕并解绑；新开关放在字幕编辑器设置。
- 验证后提交推送；不修改用户工程，不重启用户服务。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 切割工具修饰键与独立切分对象 | 已修复 | 主副轨 Ctrl／Shift 点击、指针时间与一次撤销重做、按钮跟随高亮对象共 6 项浏览器用例通过；未改变选择工具的修饰键语义。 |
| 设置布局、更多操作与自动关闭 | 已修复 | 三类分区、12px 内外间距；更多操作直接显示在取消与确认之间，默认隐藏。3 项宽度布局测试和 5 项设置／自动取消测试通过，刷新保留设置、选择其他主副卡片或波形块只撤销草稿。 |
| 回归、产物和交付 | 已修复 | 105 项相关浏览器、354 项 Node 通过；Python 全量中的旧分类断言已同步并复验。便携编辑器、操作帮助、说明与 changelog 已更新，交付分支为 `my-feature`，提交见 Git 历史。 |

## 阶段证据

- `split-inline.spec.mjs --grep 'razor|independent footer'`：6 项通过。
- 设置与布局首轮 5 项通过、3 项失败：1 项暴露新开关未加入公共设置规范化器，已修复并添加迁移回归；2 项测试点在可拖动虚线上，改为点击字幕块内部的其他位置。`--grep 'split settings|auto-close'` 复验 5 项通过。
- 1280／740／420px 的设置窗口与完整操作按钮布局通过，并已检查截图。截图与日志在仓库外，不纳入提交。
- 自动关闭不响应空白、设置、当前切分组或虚线拖动；显式发起另一处切分仍进入新的切分流程。关闭开关后保留确认区，Shift+B 无论更多操作是否显示均可用。

## 回归与交付

- `node --check`：`web/editor.js`、`web/editor-utils.js`、`web/waveform.js`、`web/editor-i18n.js` 通过。
- `node --test tests/test_editor_utils.mjs tests/test_subtitle_layers.mjs tests/test_project_style.mjs tests/test_waveform_js.mjs`：354 项通过。
- Playwright：`split-inline.spec.mjs` 50 项、`beta6-editor.spec.mjs` 13 项通过；`multi-subtitle.spec.mjs` 与 `waveform-history.spec.mjs` 匹配 `split|splitting|both lanes adjust|help reflects|contextual help` 的 37 项通过；`split-subtitle-preview.spec.mjs` 5 项通过，合计 105 个不同的相关浏览器用例。预览测试首次因未提供测试要求的 FFmpeg 环境变量而无法启动，补齐后 5 项均通过。
- 本轮未运行整个浏览器套件；此前无关的既有失败记录见 `TEST_FEEDBACK_SPLIT_SHORTCUTS_THEME_20261007.md`。
- `uv run python edit.py --blank`、`git diff --check` 通过；17 个变更文本文件均为 UTF-8／LF。源码和便携产物一致，未修改用户工程或本机设置。
- `python -m unittest discover -s tests -p 'test_*.py'`：2018 项，跳过 25 项，首轮仅 1 项失败：便携产物测试仍要求旧的“操作”独立分类标题。同步为新的三类布局后，`python -m unittest discover -s tests -p test_waveform.py -k EditorAssetTests` 11 项全部通过。未重复运行其余已通过项，本轮没有遗留失败。
