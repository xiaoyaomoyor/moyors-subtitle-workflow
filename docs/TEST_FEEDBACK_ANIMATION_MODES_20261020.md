# 动画预设与自定义编辑（2026-10-20）

基线：`my-feature / c11449da`。保留 `debug.log`、`.test-appdata/`、`output/`。不操作个人工程和云端服务。

| 项目 | 状态 | 处理 |
| --- | --- | --- |
| 动画模式与参数保存 | 已修复 | v1 可选 mode、淡入淡出起止边界与闪烁周期单位；旧数据保留原组合含义；模式只控制生效，不删除另一套参数。Node、Python、浏览器保存重开通过 |
| 预设百分比滑条 | 已修复 | 四节点淡入淡出、区间整体拖动、独立强度滑条、关闭保留参数、单项默认恢复通过浏览器；多选时间编辑保留各自强度；SVG 键盘操作与时间轴隔离，方向键不移动字幕、Delete 不误删字幕 |
| 自定义曲线 | 已修复 | 无旧下拉栏；悬停十字线与读数、右键时间／参数／插入／过渡／删除；节点形状区分过渡，其他通道时间投影；拖动取消、撤销、单位换算、保存重开通过 |
| 回归与交付 | 已修复 | Node 692/692、Python 44/44；20 个不同浏览器场景经复验全部通过，文档和生成产物已更新；提交信息在本轮回复记录 |

## 设计边界

- 预设时间固定百分比。闪烁周期也是字幕时长百分比，最低不透明度与舒展缩放是强度，使用单独的紧凑滑条，避免把不同量纲放在同一时间轴。
- 自定义不涉及文字显现；切换纵轴不会删除其他通道数据，图表用投影标记显示其他通道的关键帧时间，不自动添加无意义的联动帧。
- 鼠标操作不出现焦点描边，保留键盘焦点可见性。
- 一次拖动只提交一次；Esc、失焦、锁定或切换对象取消未提交草稿。

## 实际验证

- `node --test tests/*.mjs`（`MSW_TEST_PYTHON` 指向仓库虚拟环境）：最终 **692/692**。
- `.venv/Scripts/python.exe -m unittest tests.test_editor_assets tests.test_subtitle_animation tests.test_subtitle_background tests.test_project_subtitle_style`：**44/44**，包括新增 JS/Python 模式、四节点淡入淡出、百分比闪烁与预览/导出文本一致性。
- `npx playwright test tests/e2e/subtitle-animation.spec.mjs --reporter=line`：首轮 **11/11**。
- 动画＋属性列表回归：**19/20**，新增键盘断言发现时间轴捕获阶段抢走 SVG 方向键；修复后 `cross-track preset|custom graph context` 专项 **2/2**。全部 **20 个不同场景**通过，包含多选、锁定、保存重开、恢复继承、撤销重做、拖动取消、右键插帧/删除/过渡/坐标、窄栏布局及 ASS 预览/烧录像素对照。
- `.venv/Scripts/python.exe edit.py --blank` 与 `scripts/build_comparison_tools.py` 已重建；`git diff --check` 通过。文本产物检查 UTF-8/LF。
- 浏览器仅使用隔离配置、合成视频和临时工程，未请求云端。8250 未监听，无运行中的服务需要重启。

未运行全量 Python 或全部浏览器套件；ASS 仍受厘秒时间精度约束。自定义只提供五个 ASS 可表达的数值参数，不包含文字显现和自由贝塞尔切线。
