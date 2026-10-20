# 属性列表细节调整（2026-10-20）

基线：`my-feature / 196b59f0`。本轮只处理用户反馈的前六项，动画不改动。保留既有 `debug.log`、`.test-appdata/`、`output/`；不操作个人工程或云端服务。

| 项目 | 状态 | 处理与验证 |
| --- | --- | --- |
| 对象行对齐、删除跟随说明、角色选中效果 | 已修复 | 去掉撑高对象选择器的标签和跟随说明；选中角色使用主题强调色、底色与内描边。浏览器实测控件顶底对齐、选择标记居中，并检查窄栏浅色／深色主题截图 |
| 恢复轨道外观图标、参数名称点击恢复 | 已修复 | 使用文字＋回转箭头图标；字段名改为可键盘操作的强调色恢复控件，帮助图标独立，不显示圆点或单项图标。验证鼠标／Enter 恢复、帮助不误触、锁定、多选、撤销及位置保留 |
| 统一矩形背景 | 已修复 | 界面只有“无／矩形”，圆角 0 为直角；旧 rect 映射显示为矩形＋0，不自动改写。调整半径才转入圆角表示，恢复半径可恢复直角轨道外观。验证取色、保存、继承及 ASS／烧录像素 |
| 简化位置并调整渐变／背景分组 | 已修复 | 移除位置方式和恢复位置按钮；坐标与拖动自动进入定位，坐标名称恢复继承，渐变／背景另行分隔。横纵坐标是同一位置覆盖，恢复时一起恢复，提示中明确。直接定位支持取消、一次撤销及保存重开 |
| 回归、文档、产物 | 已修复 | Node 690 项、Python 专项 36 项；27 个浏览器场景经复验均通过；说明与 changelog 已更新，离线页面已重新生成 |

## 实际验证

- `node --test tests/*.mjs`：指定仓库虚拟环境 `MSW_TEST_PYTHON`，**690/690**。
- `.venv/Scripts/python.exe -m unittest tests.test_editor_assets tests.test_subtitle_background tests.test_project_subtitle_style`：**36/36**。最初使用系统临时目录的进程停滞，无测试结果，已中止；使用工作区隔离临时目录后完成。
- `npx playwright test tests/e2e/subtitle-properties.spec.mjs tests/e2e/subtitle-background.spec.mjs tests/e2e/selected-subtitle-position.spec.mjs --reporter=line`：**25/27**。发现名称按钮成为 label 的默认关联控件，影响背景下拉选项；为标签显式指定输入框后，包含这两项的背景、取色、布局和定位复验 **7/7**，全部 27 个不同场景已通过。
- 预跑的四个新／调整场景曾因测试假设失败：ASS 文字位置含描边内距、撤销恢复选区后需重新选轨、旧背景夹具缺少轨道字段、默认粗体已开启。修正测试入口与夹具后均通过；没有删掉对应保存、撤销、继承和像素断言。
- 浏览器只启动隔离的临时工程与合成视频，系统权限由自动审批用于 Chromium 启动；不连接云端，不操作用户工程。
- `node --check web/msw-project-style-ui.js`、`node --check web/msw-track-preview.js`、`.venv/Scripts/python.exe edit.py --blank`、`git diff --check` 通过。

本轮不改动画或工程数据格式；未运行全量 Python／全部浏览器套件。使用旧直角背景的工程保持可读，打开属性列表不自动升级背景数据。提交推送结果在本轮回复记录。
