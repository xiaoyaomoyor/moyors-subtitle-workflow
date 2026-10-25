# 全屏快捷键、说话人优先级与样式性能

基线 `dc8d7912`。不改动用户工程、个人配置或本地测试资料；沿用上轮“绑定选择暂不修改”的决定。

| 内容 | 状态 | 决定与证据 |
| --- | --- | --- |
| 反斜杠切换媒体预览全屏 | 已修复 | 复用播放器全屏操作，避开文字输入、输入法组合和修饰键；更新操作帮助。实际浏览器全屏、退出、输入框及选区保持 2 项通过。 |
| 轨道默认 → 说话人 → 单条外观优先级 | 已修复 | 现有 JS／Python 渲染和属性显示已采用此顺序，不改继承结果。补充轨道切换及 ASS 输出回归，6 项 Python、4 项 JS 和浏览器优先级流程通过，更新使用说明。新增测试首次用了不支持的空样式输入；浏览器夹具首次通过仅提交字幕结构的命令修改预览配置，均修正测试设置后通过。 |
| 样式切换减少全工程快照开销 | 已修复 | 外观／动画修改共用纯字段补丁，只校验受影响的参数，撤销仅记录这些字段；更新校验回退快照的对应字段。避免全工程转换、正文／逐词时间复制和重复属性刷新。局部撤销、锁定及无效批次原子拒绝专项通过，保持保存时完整校验。 |
| 回归与产物 | 已修复 | 717 项 JS、48 项 Python、54 项样式／编辑／保存浏览器回归及另 2 项全屏验证全部通过。便携编辑器和离线对比工具已重新生成。 |

说明：工程条数会放大全工程复制和转换成本，属于可优化的实现开销，不要求用户拆小工程。

最终长工程副本测量：6090 条字幕，单条样式切换同步处理 285–335 ms，轨道样式 483–785 ms，无页面异常（上轮分别约 2.37 s、1.77–1.79 s）。首轮优化为 417–475 ms、766–1234 ms，随后进一步移除重复面板刷新、重复校验及无关字幕归属遍历。测量为本机两次预设切换，首个轨道切换包含此前文本编辑的提交校验，不代表所有机器或操作的固定耗时；同步处理耗时不包含最终 ASS 画面渲染完成时间，尚有全工程指纹及预览刷新开销。

验证记录：

- `node --test tests/*.mjs`：717 通过。
- 设置 `PYTHONPATH=tests` 后执行 `.venv/Scripts/python.exe -m unittest -v test_speaker_palette test_project_subtitle_style test_subtitle_animation test_msw_persistence`：48 通过。第一次受限环境运行长时间没有输出，已仅停止该测试进程；隔离配置及临时目录、提升执行权限后同组测试通过，未将停滞误记为产品失败。
- `npx playwright test tests/e2e/selected-subtitle-position.spec.mjs --grep 'backslash|fullscreen arrow'`：全屏浏览器 2 项通过。
- `npx playwright test tests/e2e/editor-latency.spec.mjs tests/e2e/speaker-palette.spec.mjs tests/e2e/style-preset-workflow.spec.mjs tests/e2e/subtitle-animation.spec.mjs tests/e2e/subtitle-properties.spec.mjs tests/e2e/editor-editing-save.spec.mjs --grep 'editor-latency|speaker-palette|style-preset-workflow|subtitle-animation|subtitle-properties|save toast|same immediate progress|dense frame|save diagnostics'`：最终 54 项通过，覆盖局部撤销重做、批次校验、样式继承、动画编辑、保存重开以及精确预览／烧录画面对比。首轮有 1 项测试夹具未通过字幕结构提交同步预览配置，改用真实色系表操作后通过。
- `edit.py --blank`、`scripts/build_comparison_tools.py` 已执行；对比工具没有产物差异。源码语法、UTF-8/LF 与 `git diff --check` 通过。
- 未运行云端识别／翻译或远端 CI，未修改用户工程；本轮没有修改 Python 运行代码，不需要重启服务。
