# 字幕导出面板整合

2026-10-28，基线 `a1e10a49`。保留 `debug.log`、`.test-appdata/`、`output/`；不修改用户工程，不调用云端服务。

| 内容 | 状态 | 规则 |
| --- | --- | --- |
| 统一入口与选项 | 已修复 | 文件 → 导出字幕直接打开非模态面板；参考视频导出分类、间距、双列布局及帮助图标。整合 SRT、ASS、TXT、Lottie、OGraf；剪辑时间线与辅助数据移到独立“更多导出”／“去空隙时间线”，不混入字幕选项。 |
| 导出内容与范围 | 已修复 | 实际轨道多选；保留原字幕、合并同时显示文本、按说话人分文件。禁用内容不输出，折叠不影响；统一首条起点、名称显示与跳过空隙，所有操作只作用于导出快照。 |
| 验证与交付 | 已修复 | 字幕面板／ASS／命名／多语言说话人专项 19 项通过；批量下载快照、与视频入口并列、动态权限补充 3 项通过；真实 Lottie／OGraf 打包 2 项通过。轨道导入导出 7 项、菜单 2 项通过。Node 核心 281 项、Python 页面契约 11 项通过；深浅主题和窄窗截图已检查。已重建离线产物。 |
| 额外旧测试失败 | 仅说明 | 扩展匹配运行 37 项中曾有 9 项失败：2 项因漏配 FFmpeg、2 项因旧说话人夹具及冷字体测量等待，补齐后相关专项通过。剩余 5 项为下列非导出测试，本轮未改动相应逻辑，也未完成其基线复验，不宣称全量通过。 |

低频时间选项仅一层折叠。动态格式沿用已有单轨渲染器，面板明确选择一条物理轨道，不伪装支持多轨样式。配置沿用现有用户偏好键，工程格式不变。

首轮问题及处理：轨道勾选的 input 事件过早刷新，已改为 change 提交后刷新；窄窗勾选框受通用输入框宽度规则影响，已限定尺寸并禁止文字竖排。旧导出文件名测试的英文语言被统一配置恢复覆盖，测试改为加载完成后显式切换。旧 ASS 测试仍在媒体设置中寻找字体／预设控件，改用属性入口与工程样式夹具；首次字体测量等待延长至 20 秒，不跳过文件内容断言。

验证命令：

- `node --check web/editor.js`、`node --check web/msw-subtitle-export.js`。
- `node --test tests/test_editor_utils.mjs tests/test_subtitle_presentation.mjs`：281 通过（设置项目 Python 路径供 XML 交接测试使用）。
- `python -m unittest test_waveform.EditorAssetTests`：11 通过。
- Playwright Chromium（Edge）：`subtitle-export-panel.spec.mjs`、`ass-export.spec.mjs`、`export-naming.spec.mjs`、`speaker-palette.spec.mjs` 的多语言名称用例；另跑 `beta3-cd.spec.mjs` 的下载快照、`editor-video-export.spec.mjs` 的字幕面板入口以及动态格式校验。所有相关用例通过。
- `track-import-export.spec.mjs`：7 通过；`editor-persistence.spec.mjs`：2 通过。`waveform-history.spec.mjs` 中修改的 4 项导出／菜单用例在扩展运行中通过。
- `python edit.py --blank`；`git diff --check`；本任务文本 LF 检查。

未通过的额外用例（`waveform-history.spec.mjs`）：按空隙覆盖率禁用字幕、合并后暂停预览、合并后列表滚动、B 切分旧卡片、编辑快捷键提示显隐。失败表现为旧元素缺失／为空、按钮禁用及提示隐藏；需另行核对夹具和基线。未调用识别、翻译、TTS 云端服务，未修改个人工程。本机视频服务无需重启，刷新页面加载新前端。
