# 播放控制、拼合预览与时间工具（2026-10-21）

基线 `3faa4809 / my-feature`。保留 `debug.log`、`.test-appdata/`、`output/`；不修改用户工程，不调用云端服务。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 浅色播放器按钮 | 已修复 | 视频外改用主题前景及悬停色；真实定位状态浅／深色所有按钮与时间文本对比度不低于 4.5，回到视频内恢复亮色，1 项浏览器测试通过 |
| 拼合字幕与方向标记 | 已修复 | 合入目标／方向／编号及绑定伙伴均标记，另区分间隔延展；10 项模型和 12 项浏览器通过，已检查截图，卡片标记改为标题行内排布避免遮住时间 |
| 缩放与偏移字幕 | 已修复 | 改为明确操作、提前／延后与秒数，缩放显示前后示例；39 项浏览器回归通过，保留轨道范围、联动、原子校验和一次撤销；已检查浅色窄窗及深色截图 |

时间工具使用单个操作选择（整体移动、调整起点、调整终点、缩放时长），仅显示有关参数。缩放提供固定起点／中心／终点／整组起点；提示图标独立占位。输入和滚轮不直接修改工程。

## 验证结果

- Node 全量 700 项首轮 699 通过，1 项英文文案用例仍期待旧名称；更新“拼合字幕”的名称与提示翻译、清除本轮重命名引入的重复映射，相关文件 275/275 复验通过。新增拼合目标与间隔预览测试包含在全量内，批量拼合模型 10/10 通过。
- 浏览器：`batch-merge.spec.mjs` 12/12；`batch-tools.spec.mjs` 与 `editor-editing-save.spec.mjs` 共 39/39；真实服务播放器浅／深色对比度 1/1。列表标记改为行内后，再复验方向标记、滚轮草稿、播放器与选中字幕终点撤销 4/4。累计 53 个不同用例均有通过证据。
- 已目视检查浅色播放器控制、拼合方向与组号、深色时间面板及 640×600 浅色时间面板。标记不改变波形绝对定位，也不覆盖卡片时间文本；关闭、选区失效或参数变化后更新标记。
- `node --check` 检查三个修改的 JS 文件通过；重新生成 `blank-editor.html`，运行对比工具生成器（两份结果未改变）；`test_editor_assets.py` 19/19 通过；`git diff --check` 通过。
- 首次播放器测试夹具使用了不匹配的定位范围，修正为先选中字幕；模型测试的跨 VM 数组断言改为本地数组比较。最后四项浏览器首次启动受沙箱限制，Chromium 退出、本地服务未就绪，改为沙箱外的隔离测试工程运行后全部通过。环境失败不算作产品通过证据。

命令：`node --test tests/*.mjs`；`node --test tests/test_editor_utils.mjs`；`npx playwright test tests/e2e/batch-merge.spec.mjs --reporter=line`；`npx playwright test tests/e2e/batch-tools.spec.mjs tests/e2e/editor-editing-save.spec.mjs --reporter=line`；播放器与旧端点用例使用 `--grep` 定向验证；`.venv/Scripts/python.exe edit.py --blank`；`.venv/Scripts/python.exe scripts/build_comparison_tools.py`；`.venv/Scripts/python.exe -m unittest discover -s tests -p test_editor_assets.py`。

边界：本轮为前端改动，未重复执行 Python 业务全量、未构建安装包；未调用识别／翻译等云端服务。真实浏览器使用合成媒体与隔离工程，不修改用户工程。当前服务器每次请求读取前端源码，无需重启，刷新页面即可生效。
