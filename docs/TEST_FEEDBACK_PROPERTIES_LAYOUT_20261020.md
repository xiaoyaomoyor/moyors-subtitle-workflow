# 属性列表整理（2026-10-20）

基线：`my-feature / c4c9d5fc`。本轮实现属性模块更名、基础／进阶／动画三分类、响应式紧凑布局、统一作用对象与位置操作，以及以参数为中心的动画编辑。配置文件重整不在本轮范围。

既有 `debug.log`、`.test-appdata/`、`output/` 保留，不提交。个人工程与云端服务不操作。

| 项目 | 状态 | 处理与验证 |
| --- | --- | --- |
| 属性列表名称、基础与进阶布局 | 已修复 | 合并对象选择、预设图标同行、三分类和自适应列宽；实查 260/320px 窄栏、1450px 宽栏及浅／深色主题截图。渐变和背景直接并入进阶网格 |
| 统一位置设置 | 已修复 | 进阶集中位置方式、锚点和条件显示边距／百分比；所选字幕可跟随轨道或单独定位。百分比写入、切换对象、画面拖动、取消和撤销通过 |
| 参数动画与预设填入 | 已修复 | 曲线始终可编辑，预设只填入相关参数，文字显现／闪烁用区间条；单元测试 7/7，浏览器验证单位换算、跨轨多选、锁定、一次撤销和保存重开 |
| 浏览器与预览／导出验证 | 已修复 | 35 个不同场景均通过（包含针对首次失败项的复验），覆盖 ASS 预览、导出帧比较及裁剪动画时钟；最后紧凑布局调整后再验证 5/5 |
| 文档与产物 | 已修复 | 更新 WORKFLOW、契约说明与 changelog；生成 blank-editor.html 和两个离线对比工具。提交推送结果在本轮回复记录 |

## 验证记录

- Node：指定 `MSW_TEST_PYTHON` 为仓库虚拟环境后，`node --test tests/*.mjs` 全量 **690/690**；增加毫秒预设上限检查后，`node --test tests/test_subtitle_animation.mjs` **7/7**。
- Python：`.venv/Scripts/python.exe -m unittest tests.test_subtitle_animation tests.test_subtitle_background tests.test_subtitle_gradient tests.test_project_subtitle_style tests.test_editor_assets tests.test_comparison_build`，**47/47**。
- Chromium：`npx playwright test tests/e2e/subtitle-properties.spec.mjs tests/e2e/subtitle-animation.spec.mjs tests/e2e/selected-subtitle-position.spec.mjs tests/e2e/subtitle-background.spec.mjs --reporter=line`。首次 **31/35**；修正三处测试的旧入口和一处实际控件高度差后，包含四个失败项的复验 **7/7**。最终网格调整后，窄栏／宽栏、动画、背景和画面拖动再验 **5/5**。
- 环境问题：首次 Node 运行的 FCP7 测试因 `uv` 缓存权限失败，改用仓库已有 Python 后全量通过；首次 Chromium 被沙箱启动权限阻断，经自动审批后用本机权限启动隔离测试实例。未使用用户工程或正在使用的编辑器会话。
- 产物：`.venv/Scripts/python.exe edit.py --blank`、`.venv/Scripts/python.exe scripts/build_comparison_tools.py` 已运行；JS 语法和 `git diff --check` 通过。

本轮没有运行全量 Python 或全部浏览器套件，不涉及云端服务。动画数据格式及 Python 渲染器保持既有契约；便携 HTML 仍为近似预览。当前曲线采用有界分段近似，不增加任意贝塞尔控制柄、三维或新的动画引擎。

ASS 依据：<https://aegisub.org/docs/latest/ass_tags/>。继续采用现有 ASS 编译器；曲线经过分段编译，不声称 ASS 原生提供任意关键帧曲线。
