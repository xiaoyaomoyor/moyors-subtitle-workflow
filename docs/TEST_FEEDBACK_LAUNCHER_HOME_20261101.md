# 启动编辑器页面细节（2026-11-01）

基线 `bbe87054`。保留原有 debug.log、.test-appdata/、output/；不修改用户工程或个人配置。

| 事项 | 状态 | 决策及验证 |
| --- | --- | --- |
| 顶置文案及排序 | 已修复 | 顶置优先于 NEW；同组沿用现有排序。Python 实测 9 个顶置排在新工程前，取消其中一个顶置后新工程进入最近列表 |
| 返回启动器后右键闪退 | 已修复 | 重新聚焦的异步列表刷新会关闭刚打开的菜单；改为菜单结束后合并重绘，并恢复卡片焦点。浏览器延迟返回刷新、连续右键、Esc 均通过 |
| 选中／顶置／NEW 标记 | 已修复 | 共用选中标记的色彩、18 px 尺寸、圆形与距顶部 10 px；图钉保持实心。深浅主题截图及三标记计算样式检查通过 |
| 数量、分页与折叠精简 | 已修复 | 只保留标题计数，全部工程显示本页数量／总数；标题附近可折叠，不显示折叠目标。分页、空白行点击、标题与键盘收展通过 |
| 回归及运行加载 | 已修复 | 浏览器 44 项通过；Python 旧契约更新后 60 项界面契约复验全部通过，其余首次运行通过、1 项平台跳过。语法、产物与差异检查通过；当前启动器下次重启加载，未终止用户窗口 |

## 验证进度

- `npx playwright test tests/e2e/launcher-home.spec.mjs tests/e2e/launcher-structure.spec.mjs --project=chromium --reporter=line`：44 项通过，含布局、分页、菜单生命周期、重定位、删除、服务器控件与深浅主题截图。
- `.venv/Scripts/python.exe -m unittest test_launcher_projects test_gui_web`（`PYTHONPATH=tests`）：314 项运行，312 项通过、1 项跳过、1 项旧契约失败。失败断言要求重绘关闭菜单，与本轮修复相冲突；保留浏览器行为验证并更新为延迟重绘契约。
- `.venv/Scripts/python.exe -m unittest test_gui_web.LauncherAssetContractTests`：更新上述旧规则后 60 项全部通过；本轮涉及的 Python 测试最终无未解决失败。
- `node --check web/launcher/project-home.js`、`node --check web/launcher/launcher.js`：通过。
- `.venv/Scripts/python.exe edit.py --blank`：隔离配置下成功生成，产物无差异；`git diff --check` 通过。
- 截图人工检查：统一角标，标题计数无重复，空白区域不占用标题按钮。截图与隔离测试设置留在 `output/launcher-home-1101*`，不提交。
- 边界：浏览器模拟失焦／回焦和延迟响应；尚未在原生 WebView 窗口执行真实 Alt+Tab。当前启动器仍运行旧进程，下一次重启后加载新界面和后端排序；未终止用户窗口，未改用户工程或个人配置。
