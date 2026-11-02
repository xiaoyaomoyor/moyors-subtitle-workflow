# 新建字幕立即撤销

基线：`4de5a921`。用户确认新建空字幕后立即按 Ctrl+Z 即出现问题。
保留工作区已有的 `debug.log`、`.test-appdata/` 与 `output/`，不操作用户工程。

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 定位新建后需多次撤销 | 已修复 | 修改前 N、Ctrl 拖动、右键创建均复现；历史仅增加一条，但自动聚焦文字框后全局快捷键被输入保护拦截 |
| 一次撤销与重做 | 已修复 | 尚未输入的字幕文字框转交工程撤销并退出输入焦点；输入后保留浏览器文字撤销／重做，回到空字符串也不错误切换；保留模态窗及输入法保护 |
| 验证及生成产物 | 已修复 | 新建与编辑边界 7 项、既有服务器交互 3 项浏览器检查及 342 项 Node 检查全部通过；已重新生成空白编辑器 |

验证过程：

- 修改前真实按键检查 3 项失败，证明旧测试直接调用 `performUndo()` 漏掉自动聚焦问题。
- 修复后 7 项浏览器检查通过：三种创建入口、主副物理轨道、旧字幕编辑记录、Ctrl+Z／Ctrl+Y／Ctrl+Shift+Z、文字原生撤销重做、输入法事件及其他输入框。
- 首轮补充测试的文字撤销假设了连续打字必然合成一个浏览器历史步骤，改为一次真实文本插入；时间框默认为隐藏，改为开启现有时间操作设置并确认焦点。这两项均已通过。
- Node 回归初次因受限环境不能启动 Python 子进程失败；改用隔离环境及明确解释器后，`test_editor_utils.mjs` 与 `test_waveform_js.mjs` 共 342/342 通过。
- 既有 `waveform-history.spec.mjs` 的预览断言仍寻找平级轨道之前的 `msw-layer-preview`；更新为实际固定轨道预览／已加载的 libass 文档，并补充撤销、重做后的预览文字断言。重跑 3/3 通过。

最终验证：

- `npx playwright test tests/e2e/flat-production.spec.mjs --grep 'normal empty physical track|new cue|creation undo' --reporter=line`：7/7。
- `npx playwright test tests/e2e/waveform-history.spec.mjs --grep 'undoing a waveform-created|current-cue text keeps|current-cue Escape' --reporter=line`：3/3，实际本地服务器及合成媒体。
- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs`：342/342。
- 编辑器和两份测试的 `node --check`、`git diff --check` 通过；`edit.py --blank` 已完成。

本轮仅修改前端快捷键分派及测试，不改工程数据格式或后端。未运行全量 Python 或整段视频烧录；无用户工程写入、无云端调用。服务不需重启，页面刷新后生效。
