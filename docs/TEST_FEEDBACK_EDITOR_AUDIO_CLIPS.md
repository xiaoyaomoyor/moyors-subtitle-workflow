# 编辑器 C 阶段：音频贴片

## 基线与范围

- 用户确认百炼 WAV 合成问题已解决；继续 C 阶段，保留 B 的全部未提交工作。分支 `my-feature`，不同步上游、不提交、不推送。
- 素材拖到波形时间轴，贴片排在字幕下方；双字幕加贴片时压缩字幕厚度。贴片显示文字、默认电平热力图，可切纯色；右键静音以删除线表示。
- 同时实现计划中的移动／裁剪、选区、增益、1× 同步试听、工程保存与撤销。混音文件导出属于 D 阶段。
- 用户已确认：重叠自动分子行并同时播放；默认保护配音覆盖区间，设置可改为随媒体跳过。热力图采用固定色标 RMS dBFS，不冒充 LUFS。

| 编号 | 内容 | 状态 | 证据／边界 |
| --- | --- | --- | --- |
| C1 | 贴片 codec、采样裁剪与工程往返 | 已修复 | `test_msw_audio.mjs` 最终 9 项通过；`test_msw_tts.py` 21 项通过，含工程引用／采样裁剪往返 |
| C2 | 波形轨道、素材拖拽、紧凑布局与右键操作 | 已修复 | Chromium 通过真实拖入／移动／裁剪、紧凑双字幕、静音／撤销／删除及保存重开；50 层重叠按可见子行渲染和滚动 |
| C3 | 电平热力图、播放同步与空隙策略 | 已修复 | 第二轮 6 项通过：真实 PCM 电平差异、双贴片并发、Seek 停旧声、慢加载暂停与取消、空隙 protect／follow、尾段及无原媒体播放。密集布局改用现行设置下拉，单独补验通过，已查看基础模式截图 |
| C4 | 回归、浏览器操作、便携页与文档 | 已修复 | 全套 Python 1201 项通过（19 跳过），53.433s；Node 296 项通过；最终组合浏览器 21 项通过。收尾字幕活动态刷新后，再补验尾段与原媒体播放 2 项通过；便携页重新生成，18 项装配通过，37 个变更文本文件 LF／无 BOM |

真实云端合成已由用户确认；本阶段开发验证不消耗云端额度。

首轮浏览器命令：`node node_modules/@playwright/test/cli.js test tests/e2e/editor-tts.spec.mjs --project=chromium --grep 'audio clip'`，当时 3 项通过；后续补齐慢加载、无原媒体、尾段、缺素材及密集子行边界。

## 最终验证

- Python：用隔离配置／禁止打开真实配置文件的驱动执行 `python -m unittest discover -s tests -p "test_*.py"` 等价完整发现，1201 项，`OK (skipped=19)`，53.433s。素材引用、采样入出点和设置往返均包含在内。
- Node：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs`，296 项通过。增加调度源偏移、监听音量、节点释放、晚到加载不填入新工程缓存的验证。
- Chromium：完整 `editor-tts.spec.mjs` 首次 17／18 通过，失败来自测试移除媒体后被原有自动加载逻辑重新附着；改为启动真正不含原媒体及波形缓存的工程，相关 2 项通过。最终组合运行 21 项全部通过：`editor-translation.spec.mjs` 全部 11 项、音频贴片 8 项、TTS 取消 1 项和 `playback-refresh.spec.mjs` 不依赖 timeupdate 的刷新 1 项。原有 TTS 的 10 项在完整运行中全部通过。
- 装配：按规范以隔离配置执行 `python edit.py --blank`；`test_editor_assets.py` 18 项通过。`web/editor.js`、`waveform.js` 与三份新增音频 JS 语法检查通过，Python codec Ruff 通过；TTS 测试文件沿用既有 E701/E702 例外，其余 Ruff 通过。
- 视觉：已查看热力图、静音删除线、纯色双贴片与基础模式 50 层重叠截图。截图位于工作区外，不随仓库提交。极短的相邻贴片边框不再撑宽实际时间范围；密集区域只挂载可见子行。
- 文档：新增 `EDITOR_AUDIO_CLIPS.md`，更新 README、JSON_SCHEMA、CHANGELOG、TTS 指南及架构实施说明。保留 B 阶段全部未提交工作，未同步上游、提交或推送。

## 仅说明与验证边界

| 内容 | 状态 | 说明 |
| --- | --- | --- |
| RMS 与 LUFS | 仅说明 | 此次显示明确标注的 RMS dBFS 电平；LUFS、淡入淡出与主混音测量没有冒充已实现 |
| 导出与本地引擎 | 仅说明 | 现有导出不混入贴片，D 阶段继续音轨／混音／视频导出；本地 TTS 引擎留在 E 阶段 |
| 实际设备听感 | 仅说明 | 本次用真实 Chromium／Web Audio 和合成测试 WAV 检查状态与调度，未作用户耳机／声卡的主观延迟验收；真实云端合成正常来自用户确认，本轮无云端请求 |
| 跨浏览器和极端工程 | 仅说明 | 本轮验收 Chromium；未宣称 Firefox／Safari 或 10000 条贴片的大型工程已性能验收。缓存与子行渲染有界 |

没有外部审批阻塞；用户正在使用的编辑器服务没有被本轮测试重启或中断。

## C 阶段交互与配色优化

用户新增五项要求，完成后明确授权将当前 B／C 成果提交并推送至 `origin/my-feature`。已核对远端与本地基线同为 `624219c`；本轮不更新上游分支。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| C5 | 单击音频贴片按鼠标位置定位 | 已修复 | Chromium 单击位置与播放器时间一致；拖动／裁剪不 Seek，原素材与字幕独立 |
| C6 | 同族轮廓、半透明、静音／选区颜色、文字颜色与静音音符 | 已修复 | 自定义色浏览器用例通过，含输入事件实时生效、静音／选中叠加及热力图开关；已检查普通／静音截图。修正了副字幕文字原先单独使用弱文字的规则 |
| C7 | 回归、便携页与交付准备 | 已修复 | Python 1201 项完成（19 跳过），Node 296 项及完整 TTS／贴片 Chromium 20 项通过；便携页已生成，38 个变更文本文件通过 LF／无 BOM 与敏感内容检查 |

本轮最终验收：

- Python 完整隔离发现：`python -m unittest discover -s tests -p "test_*.py"`，1201 项，`OK (skipped=19)`，50.644s。首轮唯一失败是旧装配断言要求 CSS 选择器独占一行；改为允许共享选择器后，波形专项 17 项（2 跳过）及全套均通过，生成页面与源码一致。
- Node 五组逻辑测试：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs`，296 项通过。
- Chromium：`playwright test tests/e2e/editor-tts.spec.mjs --project=chromium`，20 项全部通过，含新增鼠标位置 Seek、移动／裁剪互斥及实时自定义配色；已查看普通和静音截图。
- JavaScript 语法、项目 CI 使用的 `ruff check` 和 `git diff --check` 通过。重新生成 `blank-editor.html`；38 个待提交文本文件没有 CRLF、BOM、真实配置文件、媒体、截图或新增个人绝对路径。
- 本轮使用模拟云端与测试 WAV，未请求真实 TTS；真实设备听感、跨浏览器、发行包和远端 CI 不在本轮已验证结论中。

交付范围包含当前已完成的 B／C 实现、WAV 修复、五项交互配色优化、测试与文档。按用户授权使用维护者身份提交并普通推送到 `origin/my-feature`；实际提交与推送结果以 Git 提交和远端分支记录为准。
