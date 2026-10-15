# 批量时间与文字操作（2026-10-15）

基线 `1fd7395`，分支 `my-feature`。落实 `TEST_FEEDBACK_TRACK_UI_DIRECTION_20261015.md` 的第二项；保留 `debug.log`、`.test-appdata/`、`output/`，不读取 `.env`，不写用户工程、不调用云服务。

| 项目 | 状态 | 范围 |
| --- | --- | --- |
| 实际轨道与批量时间 | 已修复 | 缩放／起点终点／整体偏移按物理 S 轨道、所选或整轨计算；绑定可联动，锁定／碰撞整批校验，连续手势一次撤销 |
| 批量替换与文本处理 | 已修复 | 统一作用轨道与范围；只改目标文字，不隐式修改另一侧；保留可复用词时间码和空行；预估、原子应用与主题样式 |
| 纯文本编辑与清理 | 已修复 | 轨道／范围、稳定身份与过期草稿保护；绑定结构变化拦截；空字幕清理不误删有字伙伴，清空不绕过锁定 |
| 回归与产物 | 已修复 | 77 个浏览器用例、449 项模型回归通过；Python 环境错误专项复验通过；产物、编码与 diff 检查通过 |

## 已确认规则

- 轨道分组、绑定与列表左右显示分别处理；选择实际 S 轨道，空选区不回退整轨；列表筛选／轨道折叠不扩大或缩小明确的处理范围。
- 时间处理可联动明确绑定的伙伴，保留原偏移。碰撞或锁定时整批不应用，不挤压未选择的字幕。
- 文字替换／处理仅修改目标轨文字，不复制到绑定伙伴；纯文本编辑可调整未绑定字幕行结构。
- 用户确认：纯文本编辑保留绑定，涉及绑定字幕的拆分／合并／删除时提示使用现有联动操作，不自动解绑。
- 本轮不重做识别、翻译、导出、音频补字幕或音频空隙参考轨道。

## 验证记录

- 首轮新增 `msw-batch-editing.js` 模型与 7 项 Node 回归通过。第三轮浏览器 7 通过、1 失败；失败是过期草稿已主动禁用按钮，而测试仍试图点击。随后修正断言，后续复验通过。
- 时间工具与文字处理通过实际 S2 轨道（跨列表左右列）、空选区、锁定、碰撞、词时间码与撤销验证；深色截图检查无控件遮挡。清理和未绑定行拆分通过保存往返与一次撤销验证。
- 补修纯文本输入的旧问题：预览防抖前收到重复 input 事件，会重复插入新行；改为从当前完整输入 DOM 构建草稿。
- 阶段汇总：`batch-tools.spec.mjs`、`editor-editing-save.spec.mjs`、`editor-empty-timeline.spec.mjs`、`timed-text-edit.spec.mjs` 共 36 项通过；新增批量工具模型 10 项，与既有工具／轨道回归共 449 项通过。修正旧测试对迁移前 ID、旧保存结构和卡片 dirty 容器的断言，保留相同业务验证。输入焦点延迟不再抢走用户已经选中的其他控件。
- 纯文本绑定的删除、拆分、合并及边界转移均拦截；未选择的中间字幕不能被跨过合并。词编辑保留原标记引用，清理遇到锁定的绑定／标记依赖整批拦截。文字预览只计算变化与锁定，真正应用时才重算词时间码，避免每次输入都重新映射全轨。

## 最终验证与边界

- `node --check`：editor.js、waveform.js、editor-i18n.js、msw-batch-editing.js、msw-subtitle-tracks-editor.js 通过。
- `node --test tests/test_batch_editing.mjs tests/test_batch_merge.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_flat_editing.mjs tests/test_production_project.mjs tests/test_subtitle_layers.mjs tests/test_subtitle_tracks.mjs`：449 项通过。
- 浏览器共 77 个不同用例通过：批量工具 11、时间／保存 18、空时间线与清理 6、纯文本 3、批量合并 11、生产平级轨道 25，以及旧双语文本处理／右键替换／旧层级时间调整各 1。最后对批量工具与纯文本 14 项复验全部通过；包括防抖前立即关闭草稿、清理浮窗跟随实时选区、提示图标、浅色英文 900×600、深色布局与实际 JSON 重开。截图检查后调整纯文本轨道栏宽度，避免标签折行。
- 全量 Python：`PYTHONUTF8=1`、测试 FFmpeg 加入 PATH，`uv run --frozen --no-sync python -m unittest discover -s tests -p 'test_*.py'` 首次运行 2112 项，2086 通过、25 跳过、1 环境错误，耗时 367.597 秒。原因是本次命令把 `MSW_TEST_FFMPEG` 填成可执行文件；声音复刻测试和两条轨道验证要求目录。改为 bin 目录后，分别运行 `test_msw_qwen_voices.py` 17 项、`test_subtitle_track_flow.py` 11 项、`test_editor_assets.py` 19 项，全通过（无跳过）。未重复运行整套；覆盖原环境错误和两条额外跳过，余下 23 项为条件跳过，无本轮未解决失败。
- `uv run --frozen --no-sync python edit.py --blank` 已生成；字节对比 `edit.build_blank_html()` 一致。本轮文件 UTF-8/LF，`git diff --check` 通过。
- 使用合成工程和隔离本机服务进行验证，未改用户工程、未调用云服务；未做用户实际工程人工验收或全站浏览器检查。此轮没有 Python 业务代码或数据 schema 变更，不需要重启后端，已有页面 Ctrl+F5 加载新界面。
- 仅提交本轮源码、生成产物、测试、CHANGELOG 与文档；保留原有 `debug.log`、`.test-appdata/` 和 `output/`。
