# 主副轨道垂直边距

基线 `7e45368d`。用户反馈：S1、S2 都为副字幕在上，减小 S2 主字幕垂直边距却把副字幕推高。保留本机日志和测试目录，不修改用户工程。

| 内容 | 状态 | 决定与证据 |
| --- | --- | --- |
| 定位及修复 | 已修复 | 边距输入会删除 pairLayout，再按旧边距推算间距；S2 下边缘被 S1 的自动避让限制，新增间距反而推高副字幕。手动边距改为保留排列，以初次编辑前的边距为自动排布基准，排布后仅偏移指定角色。 |
| 回归与产物 | 已修复 | JS 101 项、Python 63 项通过；浏览器 17 项覆盖最终通过（首轮 16 项通过，修正旧绑定方向断言后相关 2 项补验通过）。两组轨道、双向排列、连续输入、绑定、撤销重做、保存重开及 JS／ASS 一致。 |

实现：新增可选 `pairLayout.marginBase`，跟随样式归一化、校验、轨道槽映射及持久化；不迁移现有样式。自动排布使用基准，之后仅对手动设置的角色加差值，单条显式位置及轨道固定位置优先。手动位置可以产生重叠，不再为避让改动另一条字幕。重新选择排列／间距清除基准，恢复预设使用该预设自身参数。排布协议为 19。

验证命令与结果：

- `node --test tests/test_track_presentation.mjs tests/test_project_style.mjs tests/test_subtitle_tracks.mjs tests/test_flat_subtitles.mjs tests/test_subtitle_presentation.mjs`：101 通过。
- 以 `PYTHONPATH=tests`、`MSW_TEST_FFMPEG` 指向测试 FFmpeg 运行 `.venv/Scripts/python.exe -m unittest -v test_pair_margin test_project_subtitle_style test_subtitle_track_flow test_subtitle_tracks test_subtitle_tracks_io test_editor_assets`：63 通过，无跳过，包含真实 FFmpeg 原锚点和预览／烧录帧对比。
- Playwright / Edge：`selected-subtitle-position.spec.mjs`、`style-preset-workflow.spec.mjs` 首轮 16 通过、1 个旧绑定用例失败。核对实际数据后确认 UI 已把绑定规范为主→副，而断言仍要求副→主；更新用例，先验证当前绑定，再显式构建旧反向绑定测试保存重开，相关用例及 S2 边距流程 2 项补验通过。本轮没有改动绑定实现。
- 新浏览器夹具首轮沿用了 S1 显示编号，构建 S2 被校验拒绝；修正夹具让规范化分配编号后通过，没有放宽产品校验。
- 当前环境 PATH 无 `uv`，使用同一 `.venv` Python 运行 `edit.py --blank`、`scripts/build_comparison_tools.py`。源码语法、生成资产契约、UTF-8/LF 和 `git diff --check` 通过。

服务：按用户持续授权重启已核实的 8250 编辑器，沿用原工程和参数。对真实服务提交独立合成字幕的只读预览请求，返回 `layoutVersion:19`，边距减小 20 对应 y 增加 20。未保存或改写用户工程。

边界：未进行云端识别／翻译或整片视频导出。旧操作如果已经保存了变化后的组内间距，无法推断原意并自动还原；可先恢复原预设，再按新规则调边距。
