# 名称显示与播放器控制

2026-10-28，基线 `01174387`。基线仅有用户 `debug.log` 改动与未跟踪 `.test-appdata/`、`output/`，全部保留。

| 反馈 | 状态 | 实施与验证 |
| --- | --- | --- |
| 按语言独立显示说话人名称 | 已修复 | 数据、表格、预览／ASS／SRT 及方案库已接入；JS 12、Python 12 项通过。浏览器通过英文隐藏／中文显示、总控关闭、保存重开与撤销。首轮夹具误以为字幕事务会同时写入 preview，纠正后复测通过。 |
| 播放器设置勾选框统一 | 已修复 | 统一为 15px、主题强调色、零外边距与不压缩布局，移除说话人单独的着色规则。浏览器浅色／深色主题计算样式和点击通过。 |
| J/L 使用菜单六档倍速 | 已修复 | 用户确认逐档降速后进入倒放；K 保持播放／停止及重置。正放、倒放、上下限、按钮与按键衔接、输入控件／修饰键避让通过实际浏览器验证。 |

阶段验证：`node --test tests/test_speaker_palette.mjs tests/test_speaker_schemes.mjs` 12 项；Python `test_speaker_palette test_speaker_schemes` 12 项；浏览器 `speaker-palette.spec.mjs --grep 'language visibility|player settings checkboxes'` 2 项，均通过。

最终验证：

- JS：指定 `MSW_TEST_PYTHON` 为仓库虚拟环境，`node --test tests/test_speaker_palette.mjs tests/test_speaker_schemes.mjs tests/test_track_presentation.mjs tests/test_editor_utils.mjs`，307 项通过。首次未指定解释器时 4 个 XML 用例无法启动默认 uv；环境修正后全部通过，无生产代码改动。
- Python：隔离环境文件下运行 `test_speaker_palette test_speaker_schemes test_project_subtitle_style test_flat_subtitles_io`，31 项通过，覆盖 ASS 预览／烧录输出一致、原文与颜色不变、方案导入导出及工程读写。
- 浏览器：本机 Edge，`speaker-palette.spec.mjs` 与 `playback-refresh.spec.mjs` 共 16 项；首轮 13 项通过，另外 3 项修正测试夹具后复验通过。旧 DOM 预览测试显式启用旧渲染夹具；停止播放断言改为按键完成后取时间，避免跨帧竞争；分隔符改用语义选择器，适应新增列。实际浅色／深色截图已检查，名称开关、总控、撤销、保存重开通过。
- 生成：`edit.py --blank`、`scripts/build_comparison_tools.py` 成功；对比工具不含本轮模块，生成后无差异。修改 JS 的语法检查、18 个本轮文本文件 UTF-8/LF 检查及 `git diff --check` 通过。

边界：未改用户工程或本机个人配置，未执行付费云服务或整片视频重新编码；视频烧录使用相同 ASS 编译路径，已在专项测试核对。8250 检查时没有运行服务，无服务可重启；下一次启动编辑器加载新后端。各语言勾选不隐藏编辑用的说话人身份提示或改变着色。默认名称的继承规则随后按以下补充反馈调整。

## 默认名称显示继承（补充反馈）

基线 `4d4d128e`，状态：已修复。未填写名称、未单独设置显示的语言继承默认名称的显示开关；已经填写名称的语言默认显示。各语言明确的显示选择优先，播放器总控继续生效。JS/Python、契约及中英文帮助同步调整；保留基线日志和测试数据。

补充验证：JS `test_speaker_palette.mjs test_speaker_schemes.mjs` 12 项、Python `test_speaker_palette test_speaker_schemes` 12 项、Edge `speaker-palette.spec.mjs --grep 'language visibility'` 1 项均通过。覆盖默认隐藏、保留已填写译名、填写／清空名称、单独显示覆盖、地域语言回退、预览／导出总控、撤销和保存重开。两份生成命令成功（对比工具无差异），JS 语法与 diff 检查通过。8250 无监听服务，无需重启；未改用户工程，未整片重新编码。
