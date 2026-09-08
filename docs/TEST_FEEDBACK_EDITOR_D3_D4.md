# D3 / D4：视频混音与剪辑工程

基线：`my-feature` / `426c477`。D0、D1/D2 已按用户要求提交并推送，远端提交一致。随后开展本轮功能，保持上游不变，不调用云端合成。

后续更新：视频现已增加可选主／副／双字幕压制，素材库及播放头描边也已调整，见[后续反馈记录](TEST_FEEDBACK_EDITOR_EXPORT_ASSETS.md)。本文的验证数字和“不烧录字幕”边界保留 D3 / D4 首轮验收时的历史状态，当前用法以[视频导出说明](EDITOR_VIDEO_TIMELINE_EXPORT.md)为准。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| P1 | 提交并推送现有成果 | 已修复 | `426c47775a27d3a3b10f458125391f155fa9272d` 已推送到 `origin/my-feature`；51 个文件的发布扫描与 diff 检查通过 |
| D31 | 后台视频导出 | 已修复 | 视频测试 9 项通过，含 29.97 fps 密集切点、AAC 配音位置、画面延迟开始。短段明确写入帧时长并关闭跨段 B 帧重排，单独校验视频时长 |
| D32 | 视频面板与窗口图标 | 已修复 | Chromium 音频／视频 9 项通过，实际 MP4 下载、protect／follow、尾部选择、900×600 布局和窗口 SVG；截图已检查。原 WAV Python 21 项通过 |
| D41 | 含配音的剪辑工程 | 已修复 | Python 打包 8 项和多格式任务 13 项通过，含官方 OTIO 解包、相对素材引用、逐轨求和与参考 PCM 差异不超过 2 单位；Chromium 视频／剪辑包 4 项通过，截图已检查 |
| D42 | 集成验证与文档 | 已修复 | 全量 Python 1256 项（19 跳过）、Node 303 项通过；Chromium 首轮 26/27，既有缩放场景加可交互等待后整组 7 项复验通过。便携页已生成，编码／发布扫描通过 |

本轮 D3 / D4 在检查点提交之后开发，保留为本地未提交修改；已推送的是用户要求先保存的 D0、D1/D2 检查点 `426c477`。

阶段汇总：D3 后台和前端已完成首轮验收。编码采用累计帧边界避免切点取整误差逐段累加；完整兼容画面以包哈希验证未重编码。视频不烧录字幕／表情包，重新编码暂不接受 HDR 色彩转换。随后增加的非整数帧率与音画内容校验见下一段。

第二次汇总：非整数帧率测试确实发现连接时长误差，修复后复验通过；已增加画面起始延迟和实际 AAC 配音测试。OTIO 校验器首次 TLS 下载失败，改用系统证书后安装到仓库外测试目录，官方 0.18.1 解析器已验证可解包和全部相对媒体引用。未添加运行依赖。新增测试的参数合并与模拟渲染器签名错误已修正，均重新运行通过。

## 最终验证

- Python：仓库外隔离驱动调用 `unittest.defaultTestLoader.discover('tests', pattern='test_*.py')`，最终 1256 项通过、19 项跳过。拒绝读取真实 `.env`，本机恢复库使用测试目录。真实 FFmpeg 及官方 OTIO 解析器参与，视频 9 项、剪辑包 8 项、多格式任务 13 项均包含在全量中。
- Node：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs`，303 项通过。
- Chromium：`editor-video-export.spec.mjs`、`editor-audio-export.spec.mjs`、`editor-persistence.spec.mjs`、`fcp7-export.spec.mjs`、`subtitle-preview-geometry.spec.mjs` 首轮 26/27 通过。失败的既有缩放测试单独重复 3 次全过；为原始指针坐标操作补上手柄的 Playwright 可交互等待，随后整组字幕预览 7 项全过。没有把复验冒充全套一次通过，也没有修改生产预览缩放逻辑。新音频／视频／剪辑包的 10 个导出场景均通过。
- 真实下载：检查 MP4 编码和时长、复制视频包哈希、AAC 配音出现位置；解析 OTIOZ 全部相对媒体引用，官方解析器在另一目录解包；独立浮点音轨求和与参考 PCM 误差不超过 2 个量化单位。已查看视频、剪辑工程两张真实 Chromium 截图，小窗口有独立测试。
- 语法与产物：`node --check` 检查编辑器、波形、导出控制器和 i18n；Ruff 检查新增渲染模块、共享后台与新增 Python 测试，通过。`python edit.py --blank` 已生成最终便携页，全量测试包括生成资产契约。`git diff --check` 与变更文件的 UTF-8 / LF / BOM、凭据形状和个人路径扫描通过；未加入媒体或截图。
- 文档：同步 README、CHANGELOG、JSON 契约、编辑器指南、工作流、保存与音频文档、架构实施状态；新增[视频与剪辑工程说明](EDITOR_VIDEO_TIMELINE_EXPORT.md)。

全部条目已完成，无阻塞项。没有同步上游、调用真实 TTS、修改用户 Key、重启用户编辑器服务、添加运行依赖或再次推送。

## 未验证与交付边界

尚未在 DaVinci Resolve / Premiere 等外部剪辑软件中逐项验收，官方 OTIO 解析不等同于这些软件的导入行为。小时级压力测试、macOS / Linux、打包发行版、远端 CI 未执行。视频不包含字幕／表情包烧录或 HDR 色彩转换；OTIOZ 以标记与 SRT 交付字幕，画面尾部留空。静音副本需使用包内原始 TTS 重新链接后才能恢复声音。以上边界已在界面和使用说明中明确。
