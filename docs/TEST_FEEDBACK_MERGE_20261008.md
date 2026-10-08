# 合并交互统一（2026-10-08）

- 基线 `423564e`，工作分支 `my-feature`；保留 `.test-appdata/`、`output/`。
- 用户已确认直接合并、双向绑定联动、C 累加状态、Ctrl+Shift+C 共有状态、Ctrl+C 保留复制；胶带特效放入彩蛋独立开关。完成验证后提交推送。
- 冲突取时间最早的非空颜色／表情包并提示；共有状态要求全部一致。主副各自计算状态和时间范围，不吸收未绑定的重叠字幕。原配音不移动或重生成。一次撤销恢复整次合并。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 合并模型、绑定与撤销 | 已修复 | `node --test tests/test_subtitle_layers.mjs` 25 项通过；`merge-unified.spec.mjs` 浏览器 8 项通过，覆盖新旧工程、主副两侧、两种模式、撤销重做与保存重开。 |
| 快捷键、菜单和帮助 | 已修复 | Chromium 实际按键 5 项通过：列表／波形、主／副轨两模式、Ctrl+C 复制、输入框／文本选择／模态窗保护及未完成切分拦截。菜单和帮助同步。未单独测试安装版 Chrome／Edge 的扩展冲突。 |
| 胶带彩蛋与结果反馈 | 已修复 | 两项浏览器测试与截图检查通过：独立开关、保存设置、列表／波形主副接合处、主题色、减少动态效果、自动清理和失败时不播放。 |
| 回归和交付 | 已修复 | Node 353 项通过；Python 2018 项运行、25 项条件跳过、无失败；Chromium 41 项通过，颜色兼容调整后另复验 4 项共有模式。便携生成、UTF-8/LF、个人路径与 diff 检查通过；文档同步，按授权提交至 my-feature。 |

首轮浏览器测试发现旧版副字幕序列化遗漏颜色／表情包，已补齐，同时保留说话人字段。测试夹具修正了查询参数拼接和撤销前的空资源列表初始化；实际产品修改后 8 项全部通过。音频资源保持原样，进一步交互与全量回归待后续阶段。

快捷键首轮失败来自夹具误用剪贴板类型、不可选择的卡片文本，以及撤销恢复多选后重复 Ctrl 点击取消了选择；已校正夹具，5 项全部通过。输入、菜单、音频选区保留各自按键范围。

阶段汇总：合并模型、操作入口与特效已落盘。扩大回归后修复临时可见结果在波形中的清理遗漏和选中计数；旧测试的预览节点更新为当前多层渲染节点，标记断言改查语义值（新结果物化标记，不继续依赖外部组头），保留实际文字和时间检查。首次精确预览通过，撤销夹具补齐已有的空资源列表规范化。

最终复核补充：相同调色板名称视为同一颜色标记，忽略旧工程保留的历史色值差异；单元测试覆盖全员禁用、不同组的同内容表情包、不同路径表情包的共有规则。

## 最终验证

- `node --check web/editor.js`、`web/waveform.js`、`web/msw-subtitle-layers.js`、`web/msw-subtitle-layers-editor.js`：通过。
- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_subtitle_layers.mjs`：353 项通过，其中合并所在模型套件 26 项。
- `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py'`：2018 项、233.609 秒，`OK (skipped=25)`；使用隔离配置、应用数据和可用 FFmpeg，无云服务实际调用。
- Playwright Chromium：`merge-unified`、`subtitle-layers`、`overlay-track`、`multi-subtitle`、`waveform-history`、`split-subtitle-preview`、`beta6-editor` 中匹配 `merge|merges|合并|collision|split preserves|split keeps|serialization repairs|standalone cursor|duplicate split` 的 41 项通过；颜色身份复核后，新旧工程主副共有模式 4 项再次通过。
- 浏览器使用独立的 `127.0.0.1` 编辑器和合成媒体。覆盖真实按键、菜单、撤销重做、保存重开、音频来源、禁用显示、胶带截图、CSS 预览、libass 精确预览和 ASS 内容一致性；未替代维护者安装版 Chrome／Edge 的扩展冲突与真实工程人工验收。
- `uv run python edit.py --blank`：成功；`git diff --check`、任务文件 UTF-8/LF 和个人路径检查通过。
- 无本轮未解决失败；未重启维护者正在使用的服务，未改用户工程／本机配置，保留既有未跟踪测试目录。刷新页面可加载本轮前端修改。
