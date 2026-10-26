# 说话人多语言名称与显示规则

2026-10-26，基线 `6cf59b89`。本轮只接入多语言名称及按轨道显示；方案库、跨工程对应和拖动排序不在本轮范围。不改用户工程或本机个人配置。

| 内容 | 状态 | 决定与证据 |
| --- | --- | --- |
| 名称与轨道语言数据 | 已修复 | 可选 names 字典与原 name 默认名；轨道 language 读写兼容视图、JS/Python 校验及旧识别语言迁移。已知识别／翻译语言补入未指定轨道，保留明确选择。 |
| 表格名称语言及轨道语言入口 | 已修复 | 一个名称语言选择，空白译名回退默认名；轨道右键选择语言，锁定轨道禁改。浏览器验证编辑、清空、撤销、交换显示列、保存重开。截图检查布局紧凑，无新增常驻说明。 |
| 预览、悬浮、字幕及视频导出 | 已修复 | JS/Python 同一名称规则；浏览器悬浮、精确预览几何、SRT 和真实 ASS 接口按物理轨道输出 Erwyn／艾尔文；合并 SRT 实际处理器验证各自前缀且正文不变；Python 验证预览与烧录 ASS 完全一致。 |
| 回归、生成产物与文档 | 已修复 | JS 368、Python 57、浏览器 48 项通过，补查合并 SRT 的浏览器用例再次通过；生成页面、契约、帮助、变更记录更新，语法及 UTF-8/LF 检查通过。 |

基线问题：说话人只有一个 name，固定轨道操作视图没有传递语言，SRT 使用全局名称表。现已补齐这三处链路；身份、颜色、样式优先级保持不变。名称解析按物理轨道查找；中文简繁、区域代码与缺失译名回退在 JS/Python 均有覆盖。导出按次构建字幕归属映射，预览签名不触发整工程扫描。

验证记录：

- JS：`node --test tests/test_speaker_palette.mjs tests/test_flat_processing.mjs tests/test_production_project.mjs tests/test_bound_paste.mjs tests/test_editor_utils.mjs tests/test_track_presentation.mjs tests/test_flat_subtitles.mjs`，368 项通过。
- Python：`unittest` 的 `test_speaker_palette`、`test_project_subtitle_style`、`test_flat_subtitles`、`test_flat_subtitles_io`、`test_subtitle_tracks`、`test_launcher_flat_processing`，57 项通过；使用仓库虚拟环境及隔离临时目录。
- 浏览器：`npx playwright test tests/e2e/speaker-palette.spec.mjs tests/e2e/flat-production.spec.mjs tests/e2e/bound-paste.spec.mjs --project=chromium --reporter=line`，本机 Edge，48 项通过。补入合并 SRT 的断言后，单跑 `--grep 'localized speaker names'` 1 项通过。合成测试媒体与工程隔离于临时目录。
- 产物：`uv run --frozen python edit.py --blank`、`uv run --frozen python scripts/build_comparison_tools.py` 成功；所有修改 JS 的 `node --check`、文本 UTF-8/LF 和 `git diff --check` 通过。

验证中曾发现名称语言 UI 状态初始化晚于首轮控件刷新，导致浏览器启动错误；已提前初始化，后续 48 项浏览器测试通过。另有一次测试模块名写错和一次副字幕选择器写错，已纠正并重跑，不计作产品回归通过证据。

未验证边界：未调用付费识别／翻译服务，自动语言补齐使用本地候选夹具验证；视频未执行整片重新编码，已验证实际 ASS 生成接口与烧录 ASS 编译器输出一致。本轮检查时本机 8250 无监听服务，未执行服务重启。没有改写用户工程、本机说话人配置或进行跨工程映射、排序。
