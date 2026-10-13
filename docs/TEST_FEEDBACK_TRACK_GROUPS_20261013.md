# 紧凑编号轨道与可选主副分组

基线：`38088f5`，分支 `my-feature`。分组与字幕绑定分开：一主一副，仅管理命名与样式，不移动字幕、不创建或解除字幕绑定；解除后恢复独立编号。

| 项目 | 状态 | 验收要求 |
| --- | --- | --- |
| 稳定 S 编号、可选主副分组与默认翻译分组 | 已修复 | 保存重开、撤销、解除恢复编号；内容、绑定和位置保持 |
| 紧凑轨道头、右键和卡片编号 | 已修复 | 浏览器发现旧 owner 标签 CSS 覆盖 hidden；改为直接移除后复验通过 |
| 样式面板按组选择 | 已修复 | 同排紧凑下拉；有主副时显示切换与交换；独立轨道隐藏 |
| 轨道上移／下移 | 仅说明 | 核对波形显示顺序和自动避让优先级；保留菜单操作 |
| 回归、文档和生成页面 | 已修复 | 单元／契约／浏览器分层验证完成，按既有授权提交并推送 |

保留原有 `.test-appdata/`、`output/`；测试仅使用合成工程。不读取 `.env` 或用户工程内容。本轮服务重启需另行确认已保存且没有任务。

阶段证据：JS 模型／编辑／操作视图专项 38 项通过；Python 平级字幕契约 9 项通过。首轮浏览器 11 项中 10 项通过，原菜单、切分合并、任意轨绑定、翻译候选修订、素材、空轨创建、导入与拖动均通过。新增样式组测试已验证分别改字号、交换外观而保留位置、自定义恢复、独立轨编辑与固定位置；已查看样式工具栏截图。编号／菜单完整用例待修正重复标签后复验。

第二阶段：普通编辑器浏览器 11 项、旧位置／排布兼容 11 项均通过。真实服务流程发现新译文轨完成编号后，`created_subtitle_track` 仍引用编号前对象，后端正确拒绝；已改为从任务快照取完整轨道，再次执行识别、翻译、配音、libass、ASS、保存重开、另存为和 MP4 烧录，1 项完整流程通过。全量 Node 首次 623 项通过，Python 首次 2088 项通过、69 项跳过；补齐 FFmpeg PATH 后继续回归媒体测试。

用户已确认保存且无任务；8250 服务按原工程和参数重启，仍仅监听 127.0.0.1，HEAD 返回 200。没有读取或修改用户工程内容。

最终验收：

- Node 全量 **624 通过，0 失败**；包含分组独立于绑定、解除／排序／重开保留原编号、锁定与非法分组拒绝、删除空轨不复用编号，以及已有明确分组优先于迁移推断。
- Python 全量 **2088 项，0 失败／错误，23 跳过**。已配置 FFmpeg PATH，媒体渲染测试实际执行；剩余跳过涉及可选 numpy／OTIO、缺少本地夹具及操作系统条件。最终模型和生成资产专项另行 **28 项通过**。
- 浏览器 **23 个场景通过**：普通编辑器 11 项、旧工程画面定位／排布 11 项、真实服务完整流程 1 项。最终调整后再次执行分组／样式关键 2 项，通过；已查看紧凑轨道头、无重复标签的卡片和样式工具栏截图。
- 运行 `uv run --frozen python edit.py --blank`，生成页面已同步；JavaScript 语法、`git diff --check` 和 UTF-8/LF 检查通过。
- 无阻塞项。未调用真实收费 ASR／翻译／TTS，处理流程使用隔离的模拟服务；未在用户工程上自动编辑字幕或样式。

主要验证命令：

~~~powershell
$testFiles = @(rg --files tests -g 'test_*.mjs')
node --test @testFiles
.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py' -v
.venv/Scripts/python.exe -m unittest tests.test_flat_subtitles tests.test_editor_assets
npx playwright test tests/e2e/flat-production.spec.mjs tests/e2e/flat-production-flow.spec.mjs tests/e2e/subtitle-track-presentation.spec.mjs
uv run --frozen python edit.py --blank
git diff --check
~~~
