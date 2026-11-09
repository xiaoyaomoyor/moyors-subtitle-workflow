# 轨道对象切换、编号与便携页面退出默认分发

基线：`a068869f`，分支 `my-feature`。保留本机日志、测试数据和 output；本轮不发布版本。

| 项目 | 状态 | 处理与证据 |
| --- | --- | --- |
| S2 主副字幕选择后无法切换属性对象 | 已修复 | 编辑目标误用了历史样式存储槽；手动分组副轨可保留 main 槽，导致两条都被当成主字幕。按当前分组区分编辑对象，不改样式存储与渲染。新增真实浏览器复现先失败、修复后通过；连同 S1 联动用例共 2 项通过，覆盖样式、动画、撤销、列表换列及保存重开 |
| 新增轨道跳过 S3 | 已修复 | 旧计数保留已删除／已并组的末尾编号。前后台统一按现存最大组编号继续新增，不改已有编号与引用；56 项 Node、15 项 Python 和 3 项轨道浏览器测试通过，包含旧计数、主副分组、内侧空号保留、撤销重做与重开 |
| 便携页面退出默认分发 | 已修复 | Launcher 隐藏并禁用旧 HTML 选项，前后台忽略旧草稿／队列启用值；默认请求不生成 HTML。发行包、源码归档和 Pages 停止分发，官网移除入口；保留共享渲染与历史接口，维护边界纳入 AGENTS、开发／发布文档和专门说明 |

验证随处理逐项记录，区分自动化、浏览器与发行配置检查。

初次浏览器复现缺少夹具专用 FFmpeg 环境变量，准备阶段失败；补齐后确认 S2 两个按钮确实隐藏，再修复并通过。此环境失败不记为产品测试通过。

## 验证记录

- Node：`node --test tests/test_production_project.mjs tests/test_flat_subtitles.mjs tests/test_flat_editing.mjs`，56 项通过。新增旧计数回归在修改前失败，修改后通过。
- Python 模型：`PYTHONUTF8=1 PYTHONPATH=tests;.` 下运行 `test_flat_subtitles test_flat_production`，15 项通过，包含 JS／Python 一致性。
- 编辑器浏览器：`subtitle-properties.spec.mjs` 筛选 `manually grouped S2|bound cue properties switch`，2 项通过；`flat-production.spec.mjs` 筛选 `adding after S2|compact numbered heads|style toolbar selects`，3 项通过。测试使用合成工程和独立配置，不读取或修改用户工程。
- Launcher 浏览器：`launcher-config-output.spec.mjs` 全部 7 项通过，覆盖便携入口隐藏、旧选项不进入输出计划以及常规输出／模型设置。
- Launcher／打包 Python：`test_launcher_queue test_gui_workflow test_packaging_contract test_gui_web` 共 407 项，最终 406 项通过，1 项非 Windows 打开文件测试在 Windows 跳过。过程中修正默认 HTML 行为的旧断言、上阶段漏更新的运行环境版本断言，以及新增测试传入路径的类型；最后失败的队列模块重跑 28 项全部通过，其余已通过项未重复执行。
- `uv run python scripts/build_comparison_tools.py` 更新仍受支持的对比工具；本轮开始停止同步历史 `blank-editor.html`，详见维护边界。
- `npm run sync:docs`、`npm run build` 成功生成官网和 13 篇文档。已检查首页无在线编辑器链接，产物无 `/editor/index.html`。新增的文档同步也更新此前滞后的公开工程契约与工作流说明。
- 修改 JS 通过语法检查；Python／打包规格通过语法检查，工作流 YAML 通过解析，任务文件通过 UTF-8／LF 与 `git diff --check`。最初 YAML 检查缺少 Python 可选库，改用网站已有 YAML 解析器后通过，没有新增依赖。

## 验证边界与后续

- 本轮没有重建完整 Windows／macOS／Linux 发行包，打包验证为规格与依赖契约检查；未创建标签或 Release。后续正式发行需按发布流程执行实包验收。
- 已有轨道编号不会被重排；例如现存 S4 会继续保留，而只有 S1／S2 时新增为 S3。字幕绑定、ID、正文和时间不因编号计数修正而改变。
- 便携页面停止维护的长期规则见 [PORTABLE_EDITOR_RETIREMENT.md](PORTABLE_EDITOR_RETIREMENT.md)。当前不进行历史生成模块的整段删除。
