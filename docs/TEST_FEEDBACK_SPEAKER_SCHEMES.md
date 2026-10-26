# 说话人方案与跨工程对应

2026-10-26，基线 `af5c593f`。本轮实现可复用说话人方案、配置导入导出与工程内显式对应；拖动排序不在本轮范围。不改写用户工程与个人配置。

| 内容 | 状态 | 决定与证据 |
| --- | --- | --- |
| 方案及对应数据规则 | 已修复 | 独立人物 ID、工程行 ID 保持；只按已保存对应预选，SP／颜色／名字不自动匹配。单元验证覆盖异序、多个识别身份对应一人、冲突拒绝、缺失人物保留及严格校验。 |
| 方案库与配置管理 | 已修复 | 已登记统一配置和可单独导出的“说话人方案”；JS 18／Python 82 项通过，含导入合并、覆盖、其他分类保留和并发冲突。便携页面导入、应用、撤销及删除后重开通过。 |
| 紧凑方案入口和对应确认 | 已修复 | 表格上方方案选择与图标操作；对应表显示数量与示例，未对应保留，新增显式勾选。两个独立服务／工程的浏览器用例通过：异序对应、绑定／单条覆盖不变、预览／ASS、撤销重做、保存重开、删除方案不改工程。已检查截图。 |
| 回归、生成产物与说明 | 已修复 | 配置／说话人浏览器 18 项通过；随后补充颜色引用统计及浅色主题的跨工程专项 1 项通过。产物重建、语法、UTF-8／LF 和 diff 检查通过；已更新契约、配置清单和使用说明。 |

基线：项目色系表随 `.mosp` 保存，只有多语言名称；用户配置没有说话人方案库。既有未提交 `debug.log`、`.test-appdata/`、`output/` 保留。

实现补充：更新方案默认只更新已对应人物，保留其他集数的人物；可显式勾选加入尚未对应的人物，避免未使用的默认 SP 行累积。多个工程行对应同一人但外观不同，更新方案拒绝静默覆盖。工程保存描述快照及可选 `scheme_ref`，不依赖方案库继续渲染。

## 验证记录

- `node --test tests/test_speaker_schemes.mjs tests/test_speaker_palette.mjs tests/test_user_config.mjs`：18 项通过。
- Python unittest：`test_speaker_schemes`、`test_speaker_palette`、`test_user_config`、`test_config_transfer`、`test_config_end_to_end`、`test_editor_assets`、`test_flat_subtitles`、`test_project_subtitle_style`，82 项通过；使用隔离临时目录。
- Playwright / 本机 Edge：`speaker-palette.spec.mjs`、`config-manager.spec.mjs`、`config-final.spec.mjs`，18 项通过；两个独立端口共享隔离配置库，覆盖旧窗口不能恢复另一个窗口删除的方案。
- 最终追加：`speaker-palette.spec.mjs --grep 'speaker schemes carry'`，1 项通过，覆盖引用标记的字幕数量、浅色主题、预览与 ASS 名称、单条覆盖、保存重开、撤销和冲突保护。已查看深／浅主题截图。
- `uv run --frozen python edit.py --blank`、`uv run --frozen python scripts/build_comparison_tools.py`、修改 JS 的 `node --check`、`git diff --check` 与 25 个本轮文本文件 UTF-8／LF 校验通过。

回归过程中，旧配置测试的分类计数随新增分类更新；缓存检查的工程比较排除独立的启动播放位置检查点，仍比较全部字幕与媒体内容。对应表专项发现运行态引用和 v4 引用格式不同，已分别解析并复验，不改字幕引用本身。

未验证边界：未调用真实云端识别／翻译，没有执行整片视频编码；原生 ASS 生成与 libass 预览已验证。未动用户工程及个人配置；本机 8250 无监听服务，无需重启。拖动人物排序属于下一阶段。
