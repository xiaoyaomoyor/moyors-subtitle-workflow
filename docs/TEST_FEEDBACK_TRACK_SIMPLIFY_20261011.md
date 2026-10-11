# 轨道头精简与用途／排布分离

基线：`ecc29e9`，工作分支 `my-feature`。本轮保留主副存储、绑定与固定归属，不实施独立平级轨道或任意子轨道重构。

| 项目 | 状态 | 验收 |
| --- | --- | --- |
| 精简轨道头与右键管理 | 已修复 | 名称点击启用／禁用；右键重命名、设置和新增；移除常驻输入及新增工具栏，双语保留折叠入口；键盘 Shift+F10 可管理 |
| 用途与排布属性分离、旧工程兼容 | 已修复 | 用途仅标记；自动／固定独立；元数据升级 v2，独立 style_base 保留旧注释样式；旧工程原位置和样式不变，首次写回原始备份 |
| 识别、预览和导出适配 | 已修复 | 所有启用且未锁定轨道可作为 ASR 目标，用途不影响排布／导出范围；SRT 默认全部启用轨道；布局协议升为 6 |
| 回归、产物、文档与推送 | 已修复 | Node 577 项通过；Python 2064 项完成、23 项跳过、无失败；浏览器 35 项通过；已重生成产物并更新契约／指南／changelog，随本次提交推送工作分支 |

初始核查：当前轨道头包含折叠按钮、名称输入框和菜单按钮，并有独立新增工具栏。kind 同时控制自动排布、注释样式基础、ASR 可用性和 SRT 默认范围，需逐项拆开。点击当前轨道头仍作用于本轨道的主副行；独立源／译轨道属于后续阶段。

测试只使用合成工程与隔离服务，不读取个人工程或环境密钥。工作区既有 `.test-appdata/`、`output/` 保留且不提交。普通执行器出现 setup refresh 初始化错误；只读提权命令可正常执行，后续在授权范围内使用该执行路径。

阶段验收：

- `node --test tests/test_subtitle_tracks.mjs tests/test_track_presentation.mjs tests/test_subtitle_track_flow.mjs`：调整旧版本拒绝用例至 v99、旧注释夹具显式排布；新增用途独立、旧外观不变及识别目标覆盖。首轮新增测试出现跨 VM 原型比较问题，改用序列化等价检查。
- Python 专项 41 项通过，含真正 FFmpeg 预览／烧录帧一致、v3 旧元数据升级仅备份一次、禁止旧结构覆盖新排布。
- 隔离 Chromium `subtitle-track-edit`、`subtitle-track-presentation`、`subtitle-track-flow` 共 33 项通过。验证真实右键、名称切换、提示图标、键盘入口、撤销／重开、主副移动／切分／合并、拖动边界、定位和实际 ASS 对比。截图已人工查看，无标题或控件遮挡。
- 全量 Node 首轮 571/572 通过；唯一失败是样式测试未加载新增轨道依赖，已与生产加载环境对齐。补齐字段校验用例后的最终全量 **577/577 通过**。
- 全量 Python 首轮有 3 项 FFmpeg 路径测试失败，原因是本次测试命令额外设置的 `FFMPEG_PATH` 覆盖了用例模拟路径；移除该环境覆盖后复验 **2064 项、23 项跳过、无失败**（292.610 秒），没有修改这些用例或降低断言。

兼容决定：旧 `kind` 留作历史标识，实际用途、排布、样式继承分别使用 `purpose`、`layout`、`style_base`。旧单条字幕的显式位置覆盖继续有效；自动排布忽略轨道级锚点但不删除它，切回固定可恢复。用途标签不推断主副身份，不改动现有绑定和数据存储。

最终验收：

- `node --test tests/test_*.mjs`（PowerShell 展开文件列表，指定本仓库 Python）：577 项通过。
- `.venv/Scripts/python.exe -X utf8 -m unittest discover -s tests -p 'test_*.py'`（只用 `MSW_TEST_FFMPEG` 指定测试工具，清除 `FFMPEG_PATH` 覆盖）：2064 项，23 项跳过，无失败。
- `npx playwright test tests/e2e/subtitle-track-edit.spec.mjs tests/e2e/subtitle-track-presentation.spec.mjs tests/e2e/subtitle-track-flow.spec.mjs --workers=1`：35 项通过；追加普通源／译用途轨道固定定位、用途切换不改变几何、撤销恢复、浏览器 v3 旧元数据备份与降级拒绝。
- 所有修改 JS 的 `node --check`、`git diff --check` 和 35 个修改文件的 UTF-8/LF 检查通过；`uv run --frozen python edit.py --blank` 已重新生成便携编辑器。
- 识别、翻译、配音用合成任务验证归属和结果应用边界，未调用付费外部服务。预览／ASS／烧录使用真实 Chromium、libass 和 FFmpeg 验证。
- 当前 8250 服务未重启，避免中断用户编辑；加载本轮后端更新需保存工程、重启编辑器服务后 Ctrl+F5。旧服务无法接受新轨道元数据，单独刷新不能加载 Python 更新。
