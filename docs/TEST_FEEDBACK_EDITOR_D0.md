# D0：工程保存与素材收集

基线：`my-feature` / `20fe1ab`，工作区干净。用户授权实施 D0，并调整文件菜单。保持现有 Web 编辑器，不推进 D1 音频渲染或 E 引擎，不调用云端合成。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| D01 | 文件菜单导出分类 | 已修复 | 移除重复工程导出，更多导出与去空隙版本归入字幕；视频／音频渲染入口置灰。修复悬浮计时器重开父菜单、同层鼠标走廊、逐层键盘返回及窄窗口边界，Chromium 通过 |
| D02 | 新建／保存／另存为及素材收集 | 已修复 | 最终保存／恢复 Python 测试 14 项通过；Chromium 覆盖新建绑定、另存为收集和重开、弹窗暂停原工程自动保存、复制期间新编辑仍未保存、服务故障时仅下载数据。系统选定目标用模拟替代 |
| D03 | 素材完整性与搬移验证 | 已修复 | 保存测试 9 项与 TTS 服务测试 21 项通过；保留缺失引用；脱离暂存重开；独立副本与晚到素材归属验证通过 |
| D04 | 恢复草稿与历史备份 | 已修复 | Python 保存／恢复测试 14 项通过；Chromium 验证主副字幕和贴片恢复、未命名草稿及未结束内联文本；恢复不覆盖正式文件。历史按分钟采样，限制条数与容量 |
| D05 | 回归、便携页与文档 | 已修复 | 全量 Python 1215 项（19 跳过）；Node 297 项通过；最终聚焦 Chromium 12 项通过。便携页重新生成，资产契约 18 项通过；编码、凭据形状和个人路径扫描无发现 |

全部条目已完成。保存与恢复弹窗截图已在真实 Chromium 页面检查，按钮使用现有设计令牌。实现和使用边界见 [工程保存与恢复](EDITOR_PERSISTENCE.md)。未重启用户服务，未调用真实 TTS 服务。

## 验证记录

- Python：隔离测试驱动调用 `unittest.defaultTestLoader.discover('tests', pattern='test_*.py')`，最终 1215 项、19 项跳过。驱动禁止读取真实 `.env`，恢复库落在临时目录；最后生成页与媒体归属修改另复验 `test_editor_assets.py`（18 项）和 `test_msw_persistence.py`（14 项），均通过。
- Node：`node --check` 检查 `editor.js`、`waveform.js`、`msw-persistence.js`、`msw-audio.js`；`node --test` 执行 `test_editor_utils.mjs`、`test_waveform_js.mjs`、`test_msw_translation.mjs`、`test_msw_tts.mjs`、`test_msw_audio.mjs`，297 项通过。XML 子检查显式使用项目 Python。
- Chromium：`editor-tts.spec.mjs`、`editor-persistence.spec.mjs`、`fcp7-export.spec.mjs`、`subtitle-preview-geometry.spec.mjs` 进行回归，另检查 `waveform-history.spec.mjs` 的嵌套菜单及去空隙导出。最终 12 项聚焦复验全过；之前失败的文件菜单／另存为场景各重复 3 次，共 6 次通过。
- 初轮失败包括新增脚本清单未同步、测试默认路径被隔离环境影响、Node XML 解释器未指定及旧菜单定位方式；分别修正契约或测试环境。交互回归进一步发现父菜单延迟重开、嵌套键盘返回和贴片快捷键拦截菜单的问题，修复后复验通过。热力图颜色断言改为等待实际异步重绘，避免读取瞬态样式。
- `python edit.py --blank` 已从源码生成最终便携页；`git diff --check`、UTF-8/LF/BOM 检查及新增内容敏感形状扫描通过。未加入媒体、截图或个人路径。

## 未验证边界

Windows/macOS/Linux 的真实系统保存对话框没有在自动化中操作，使用受控目标模拟；需实机验收。未进行打包版本、远端 CI 或云端合成验证。视频／音频渲染属于后续阶段，当前入口明确置灰；D0 不承诺收集已有表情包等其他外部依赖。
