# 查找并编辑第一阶段：搜索与定位

基线 `4b44b4e7`，2026-10-28。按 `PLAN_FIND_EDIT_PANEL_20261028.md` 仅实施阶段 1。
保留 `debug.log`、`.test-appdata/`、`output/`；不修改个人工程，不调用云服务。

| 项目 | 状态 | 范围 |
| --- | --- | --- |
| 正文查询与范围 | 已修复 | 稳定 ID、全部／指定多轨／固定选择、增量正文索引、查询取消；模型 5 项通过，浏览器范围与 6000 条查询通过 |
| 工具面板与快捷键 | 已修复 | Ctrl+F、可拖动缩放、虚拟列表、匹配设置、主题与帮助；修正匹配选项遮挡清空按钮、范围标签换行 |
| 波形标记与定位 | 已修复 | 标记、关闭清除、按稳定 ID 选择、折叠锁定定位、真实合成音频跳转到 51 秒已通过；定位不会启用禁用字幕或解锁轨道 |
| 验证与交付 | 已修复 | 347 项 Node、10 项新增浏览器、4 项原文字工具回归、11 项前端资产契约通过；隔离本地服务、离线重建和语法／格式检查完成 |
| 替换、文字整理、连续编辑 | 仅说明 | 属于后续阶段，本轮保留原三处工具 |

## 事实基线

旧替换预览调用工程转换和全量检查，不用于实时查询。新模块只读正文和轨道归属；搜索状态不写工程，不修改播放、颜色或选区，只有主动定位时改变播放头与选择。

## 阶段记录

- 提取 `msw-find-core.js`，在可终止 Worker 中执行正则；无 Worker 环境只允许普通文字搜索。查询防抖 170ms，正则超时 1500ms；保留明确匹配数量上限，忽略零宽匹配。
- 面板复用 `createFloatingPanel`，新增正文增量索引、固定选择范围、按可见区域绘制结果。波形标记只操作界面样式，不写工程颜色。
- 首轮浏览器夹具缺少主副分组，触发重复编号；改为真实绑定关系。后续修正测试对迁移后 ID、`changedCueIds` 的 Set 类型以及音频可 seek 时机的假设，不弱化业务断言。
- 目前普通查询、范围、大小写／正则、关闭重开、文本修改、ID 重排、换工程重置及窄窗布局已通过。6000 条初查连同打开面板的自动化端到端耗时约 1.3–1.6 秒，结果 DOM 少于 30 条；失控正则超时后普通搜索可继续。此耗时包含浏览器自动化等待，不作为纯查询算法耗时。
- 最终回归发现复杂正则提示断言触及 60 秒测试时限。CDP 暂停调用栈确认阻塞点为 Playwright 的 `ariaSnapshotForExpectFailure`／`generateAriaTree`，不是查询工作线程；对该大工程状态改用 `expect.poll(textContent)`，避免重试时遍历完整工程 DOM。6000 条夹具保留全部字幕及时间范围，降低无关波形采样密度；未放宽正则超时断言。
- 增补导航保护：查找定位先清除待绑定操作，避免选择搜索结果时意外提交字幕绑定。
- 真实隔离本地服务已启动并通过打开、默认全部轨道、输入查找、Esc 关闭检查，页面无脚本异常；原三项文字工具回归 4 项通过。

## 最终验收

- `node --test tests/test_find_edit.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs`：347 项通过（`MSW_TEST_PYTHON` 指向本地测试解释器）。
- `npx playwright test tests/e2e/find-edit.spec.mjs --project=chromium --reporter=line`：10 项通过，包含 6000 条字幕虚拟列表、复杂正则终止与普通查询恢复；最终运行初查含打开面板和自动化等待 2.750 秒。先前运行 1.3–2.8 秒，不能视为稳定的纯算法延迟；本轮未完成第 4 阶段全部性能测量。
- `npx playwright test tests/e2e/find-edit.spec.mjs tests/e2e/batch-tools.spec.mjs --project=chromium --grep 'result navigation|batch replacement|text processing|pure text'`：5 项通过，其中 4 项为原有文字工具回归。
- `python edit.py --blank`：已从源码重建离线产物。设置 `PYTHONPATH=tests` 后执行 `python -m unittest test_waveform.EditorAssetTests`：11 项通过。首次未设置测试路径导致模块导入失败，补齐路径后通过。
- Node 语法检查覆盖两份新模块及 editor／waveform／i18n；`git diff --check` 通过。检查浅色、深色及窄窗截图，输入、匹配选项和导航按钮无遮挡。
- 本轮不更改真实个人工程；未调用识别、翻译等云服务，未运行全量 Python 回归或远端 CI。替换、文字整理、连续编辑仍在原入口，后续按第 2–3 阶段迁移。
