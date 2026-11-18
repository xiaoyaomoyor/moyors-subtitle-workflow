# 复核列表空白

用户反馈：打开复核列表后窗口完全空白，找不到「＋时间点」。本轮修复显示问题，不追加功能或发布版本。

| 项目 | 状态 | 事实与下一步 |
| --- | --- | --- |
| 恢复布局后复核列表空白 | 已修复 | 两个真实入口均复现按钮不存在；初始化改为读取停靠系统保留的面板节点，不依赖窗口当时是否挂在页面中。 |
| 回归与交付 | 已修复 | 浏览器 8/8、复核核心 3/3、页面装配 19/19 通过；旧版临时恢复步骤另行实测通过，提交推送工作分支。 |

基线 `my-feature` / `9b6b9661`。保留 `debug.log` 的 35 行改动，以及 `.test-appdata/`、`output/`、`tests/test_data/_msw/`。仅使用隔离设置与合成媒体，不读取真实 `.env`。`main` 与已发布 v1.8.0-beta.1 标签／附件保持不变。

## 复现与处理

- 默认布局中打开复核列表，关闭并保存工程，重新加载后通过「窗口 → 显示窗口」或标签栏「＋」打开。修复前新增两个浏览器用例均失败，按钮完全不存在；不是空列表提示或未选择时间范围导致。
- `applyCustomLayoutTree()` 会将关闭的窗口移出 DOM，但保留在 `wave.reviews`。`msw-review-ui.js` 原来通过 `document.getElementById()` 查找内容节点，查找失败后直接退出，后续打开窗口也不会重新初始化。
- 改为从保留的面板实例获取内容节点，维持原来的初始化顺序与窗口布局。回归测试覆盖无标记的旧工程及带已有备注的工程；测试夹具改为每例独立，避免保存布局相互污染。

## 验证结果与交付边界

- 修复前：`npx playwright test tests/e2e/review-markers.spec.mjs --grep "closed review panel"` 两项均在恢复自定义布局后的「＋时间点」可见断言失败，确认实际复现。
- 修复后：`npx playwright test tests/e2e/review-markers.spec.mjs tests/e2e/dock-preview-selection.spec.mjs`，8/8 通过（55.8 秒）。覆盖两个真实打开入口、空列表、已有备注恢复、新增与撤销、区段操作、保存重开及停靠回归。人工查看恢复后的截图，工具栏、筛选和空列表提示正常。
- `node --check web/msw-review-ui.js`、`node --check tests/e2e/review-markers.spec.mjs` 通过；`node --test tests/test_review_markers.mjs` 3/3 通过；`python -m unittest tests.test_editor_assets` 19/19 通过。`git diff --check`、本轮文件 UTF-8/LF 检查通过。
- 使用隔离浏览器将页面中的初始化表达式替换为原版，三次加载均保持原版逻辑：复现空白后，保持复核窗口打开，保存工程，再完整刷新页面，工具栏恢复且可新增标记。无需清空配置或重置自定义布局。
- 源码修复进入 `my-feature`；已下载的 v1.8.0-beta.1 安装包不会自动获得此修复。本轮未重新打包、发布或替换附件，也未运行整库和三平台发布回归；上述专项适用于本次面板初始化改动。
