# D1 / D2：配音轨与混音 WAV 导出

基线：`my-feature` / `20fe1ab`，保留已完成且未提交的 D0 修改。用户要求说明素材收集和恢复记录，并实施 D1、D2；不推进视频渲染及其他 TTS 引擎，不调用云端服务。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| Q1 | 自动收集的范围 | 仅说明 | 当前工程素材库全部登记音频，含未使用素材；重复贴片不重复收集，不混成成品 |
| Q2 | 素材检查与恢复记录 | 仅说明 | 检查登记 TTS 文件与哈希，不扫描磁盘；本机草稿和采样历史，不区分手动／自动保存，不含音频字节 |
| D11 | 统一音频计划 | 已修复 | JS 6 项、Python 3 项通过，共用 5 组手算夹具覆盖 protect／follow、原声选择、范围、静音、44.1 kHz 半采样取整；后续纳入实际声音回归 |
| D12 | 后台 WAV 渲染 | 已修复 | 最终 Python 音频测试 21 项通过：真实 FFmpeg 渲染 8 项、HTTP／任务 10 项、计划 3 项；覆盖多音轨、分块叠加、峰值保护、取消、重启清理、下载保留及亚采样裁剪 |
| D21 | 导出音频交互 | 已修复 | 最终 Chromium 6 项通过：真实 WAV 下载与采样长度、混音不受试听静音影响、快照编辑与刷新记录、缺失素材失败、旧服务重启提示、小窗口布局。截图已检查 |
| D22 | 回归与文档 | 已修复 | Python 全量 1233 项（19 跳过）及最终音频 21 项、生成资产 18 项通过；Node 303 项；Chromium 回归 46 项及最终导出 6 项通过。源码语法、Ruff、diff 和发布形状扫描通过 |

阶段汇总：计划及后台已通过合成音频校验；修正了单声道转立体声的电平映射，使其与 Web Audio 试听一致。脉冲边缘重采样产生的过冲也纳入峰值保护。前端 4 项实测通过；首轮 1 项失败由测试拦截器过早释放引起，改为等待请求处理完成后复验。D0 证据见 [D0 记录](TEST_FEEDBACK_EDITOR_D0.md)。

全部条目已完成，无阻塞项。使用说明见 [音频导出](EDITOR_AUDIO_EXPORT.md)；已同步工程契约、保存说明、字幕／TTS 指南、工作流、README、架构实施记录和 CHANGELOG。

## 验证记录

- Python：隔离驱动执行 `unittest.defaultTestLoader.discover('tests', pattern='test_*.py')`，1233 项通过、19 项跳过。驱动拒绝读取真实 `.env`，恢复库和媒体均为测试临时数据。收尾增加重启清理、下载授权保留和亚采样边界后，单独执行 `test_msw_audio_*.py`，最终 21 项通过；没有把这次聚焦复验冒充重新运行全量。
- Node：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs`，303 项通过。XML 子检查通过环境变量指向项目 Python。
- Chromium：`editor-audio-export.spec.mjs`、`editor-persistence.spec.mjs`、`editor-tts.spec.mjs`、`fcp7-export.spec.mjs`、`subtitle-preview-geometry.spec.mjs` 五组回归，46 项通过；最终导出用例扩为 6 项后全部通过。实际下载 WAV，按 RIFF 块解析 PCM，检查时长、开头静音、贴片位置、原声与去空隙输出。旧服务提示及 900×600 布局均通过。
- 源码：`node --check` 检查 `editor.js`、`waveform.js`、`msw-audio-export.js`、`msw-audio-render-core.js`、`editor-i18n.js`；`ruff check` 检查新增的 3 个后台模块及修改的 API 适配器，均通过。Ruff 首轮发现的 5 处行内分号已改为分行。
- 产物：`python edit.py --blank` 从最终 `web/` 源码重新生成；`test_editor_assets.py` 18 项通过。`git diff --check`、51 个变更文件的 UTF-8/LF/BOM、凭据形状与个人路径扫描通过；JSON 契约夹具按文本纳入扫描。未加入媒体或截图。
- 临时服务与浏览器独立运行，未重启用户的编辑器服务；未调用云端 TTS，未同步上游，未提交或推送。

## 未验证边界

真实音频测试使用已安装的 FFmpeg 与合成 WAV／双音轨媒体，在 Windows 执行。尚未进行小时级项目压力测试、macOS/Linux 实机或打包发行版验收，也没有远端 CI 证据。分块／多输入用例以较小块强制跨批运行，验证有界算法，但不等同于长项目性能基准。视频混音渲染及 E 阶段引擎不在本次范围内。
