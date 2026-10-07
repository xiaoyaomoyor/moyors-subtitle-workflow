# 普通／快速切分、波形预览线与主题颜色（2026-10-07）

- 基线 `67a8ba9`，分支 `my-feature`；保留未跟踪 `.test-appdata/`、`output/`。
- 授权范围：绑定字幕普通切分总是内嵌确认，Ctrl+B 按时间快速联动；同步列表／确认区与波形切分线；统一相关颜色并写入用户提供的五套主题色；验证后提交推送。
- 主题以本轮手写色值为依据，不读取或覆盖用户工程及个人服务配置。

| 项目 | 状态 | 处理与验证 |
| --- | --- | --- |
| 普通与快速切分、操作帮助 | 已修复 | 绑定字幕普通切分始终先确认；Ctrl+B 优先波形鼠标时间，否则使用播放头。帮助与中英文本已更新。`split-inline.spec.mjs` 20 项通过，覆盖主副波形快捷键、固定切点、无时间码估算、无效切点保护和一次撤销。 |
| 波形同步切分预览线 | 已修复 | DOM 覆盖层显示实际切点，列表预览按合法文字边界对齐；确认区时间优先，关闭和切换工程时清除。浏览器专项累计 24 项通过，覆盖主副列表悬停、不改数据／播放头、不重建画布、波形行重排与缩放、取消／提交／工程切换。 |
| 切分与编辑焦点颜色 | 已修复 | 切分虚线、按键边框、闪光和可选刀光统一使用强调色；正文／时间／配音输入框焦点使用选区色。去空隙危险按钮、素材待复核标记改用已有语义色。明暗主题自定义颜色的浏览器断言及截图通过。 |
| 五套主题预设默认值 | 已修复 | 内置灵梦选区 `#ebbf2d`，爱丽丝播放头 `#f83030`，莲子播放头／选区 `#703e3e`／`#8d2f07`，小铃播放头／选区 `#47904f`／`#db4614`，紫苑选区 `#ac8a2a`。五套颜色实测断言、明暗预设截图与自定义覆盖保留检查通过。 |
| 回归、产物与交付 | 已修复 | 说明、changelog 与便携编辑器均已更新；353 项 Node 和全量 Python 通过，本轮浏览器专项通过，27 项历史浏览器失败已逐项对照基线记录。交付分支 `my-feature`，具体提交见 Git 历史。 |

第一轮快捷键回归的两项失败为测试期望使用了浮点毫秒；工程契约要求整数毫秒，已修正期望并通过复验，生产切点未为迎合测试而改动。

## 最终回归证据

- `node --check web/editor.js`、`web/waveform.js`、`web/editor-i18n.js`：通过。
- `node --test tests/test_editor_utils.mjs tests/test_subtitle_layers.mjs tests/test_project_style.mjs tests/test_waveform_js.mjs`：353 项通过。
- `python -m unittest discover -s tests -p 'test_*.py'`：2018 项，跳过 25 项，其余通过；使用隔离配置与数据目录，未读取个人密钥。
- `uv run python edit.py --blank`：已重新生成便携编辑器；`git diff --check` 通过。
- Playwright 综合范围：`split-inline`、`split-subtitle-preview`、`multi-subtitle`、`waveform-history`、`cue-cards`、`branding`，共 185 项；首轮 155 通过、30 失败。本轮 25 项切分专项及 5 项精确字幕预览全部通过。
- 其中 3 项随本轮行为修订：普通切分说明文字、可靠绑定字幕仍需确认、单词模式悬停夹具必须有合法词间分界；分别复验 2 项和 1 项，全部通过。
- 余下 27 项均在修改前 `67a8ba9` 的独立源码副本中逐项复现（5 + 21 + 1 项）。未跳过或改写这些失败断言，也未将综合浏览器回归报告为全绿。
- 视觉检查：1280／740 宽度的内嵌切分布局、明暗主题虚线／按键提示、七套内置主题截图；截图和运行日志仅保留在工作区外的临时验证目录。

## 本轮之外的已有浏览器回归失败（仅说明）

下表各项都同时在当前版本与修改前基线失败。部分旧测试仍针对 CSS 预览节点、旧设置控件或旧轨道行为；本轮仅确认其非新增，尚未逐项判定是陈旧断言还是产品缺陷。后续应以现有 ASS 预览、设置布局和多轨行为重新核对，再分别更新测试或修复。它们不属于此前已修复的五项 Python 失败。

| 测试文件 | 失败用例 |
| --- | --- |
| `tests/e2e/cue-cards.spec.mjs` | more hover details show both subtitle tracks and total duration |
| `tests/e2e/multi-subtitle.spec.mjs` | extension list clicks auto-scroll and double-click places the caret at the pointer |
| `tests/e2e/multi-subtitle.spec.mjs` | raises both subtitle lanes moderately in basic waveform mode |
| `tests/e2e/multi-subtitle.spec.mjs` | merges selected extension cues from the context menu and C, with undo |
| `tests/e2e/multi-subtitle.spec.mjs` | hides the extension preview while the playhead is in its timing gap |
| `tests/e2e/multi-subtitle.spec.mjs` | Shift+arrow snaps selected main and secondary cues in multiple-subtitle mode |
| `tests/e2e/multi-subtitle.spec.mjs` | 选中的主字幕与绑定副字幕一起合并并支持撤销 |
| `tests/e2e/multi-subtitle.spec.mjs` | ignores a tiny unbound extension overlap at the main merge boundary |
| `tests/e2e/multi-subtitle.spec.mjs` | 拼合主字幕时同步延展绑定副字幕并支持撤销 |
| `tests/e2e/multi-subtitle.spec.mjs` | shows independent extension preview controls with yellow defaults |
| `tests/e2e/multi-subtitle.spec.mjs` | refreshes local font options for both main and extension subtitles |
| `tests/e2e/multi-subtitle.spec.mjs` | localizes approved scanned font labels in both selectors |
| `tests/e2e/multi-subtitle.spec.mjs` | keeps the main range fixed and removes a fully covered extension cue on H alignment |
| `tests/e2e/multi-subtitle.spec.mjs` | keeps the longer remaining side and restores extension time order after H alignment |
| `tests/e2e/multi-subtitle.spec.mjs` | keeps the main range fixed when its extension follower hits another extension cue |
| `tests/e2e/multi-subtitle.spec.mjs` | offers extension cue creation on the empty extension lane and makes it undoable |
| `tests/e2e/multi-subtitle.spec.mjs` | snaps an extension cue to main-track boundaries when cross-track snapping is enabled |
| `tests/e2e/waveform-history.spec.mjs` | blank waveform context menu disables subtitle creation over an existing cue |
| `tests/e2e/waveform-history.spec.mjs` | disables subtitles by removed-gap coverage and remaining duration thresholds |
| `tests/e2e/waveform-history.spec.mjs` | N creates a subtitle at the waveform pointer and focuses the new cue |
| `tests/e2e/waveform-history.spec.mjs` | Ctrl+dragging an existing cue is rejected without a preview |
| `tests/e2e/waveform-history.spec.mjs` | Ctrl+dragging from blank space stops at an existing cue boundary |
| `tests/e2e/waveform-history.spec.mjs` | current-cue text keeps the list and waveform labels in sync through undo and redo |
| `tests/e2e/waveform-history.spec.mjs` | C merge refreshes the paused main subtitle preview |
| `tests/e2e/waveform-history.spec.mjs` | C merge keeps the subtitle list at its current position |
| `tests/e2e/waveform-history.spec.mjs` | B and C refresh cue overlays without redrawing cached waveform canvases |
| `tests/e2e/waveform-history.spec.mjs` | C merges a common group and Shift+A/D extends the subtitle selection |
