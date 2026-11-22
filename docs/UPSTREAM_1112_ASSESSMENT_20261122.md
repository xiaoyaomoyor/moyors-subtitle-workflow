# MAW v1.11.2 跟进筛选

建议 MSW 继续使用 v1.11.1。本次上游补丁唯一影响字幕行为的改动，已经由 MSW 的 ASS 默认值和工程动画系统覆盖。

以 MSW v1.11.1 的发行提交 `97445935` 为基线，核对 MAW v1.11.1 `b0a9bcbd` 到 v1.11.2 `4411be2a` 的 2 个提交、25 个文件。上游于 2026-11-11 发布。发布说明下半段汇总的是 v1.11.0 功能，`uv.lock` 的变化只涉及项目自身版本号。 [MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.11.2) · [标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.11.1...v1.11.2) · [MSW v1.11.1](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.11.1)

| 上游改动 | MSW 核对结果 | 建议 |
| --- | --- | --- |
| 内置 ASS 输出方案恢复默认关闭淡入淡出。放大出现也保持关闭。 | MSW 的兼容 ASS 样式在 Python 和编辑器都默认关闭动画。旧方案只有淡入淡出时长、缺少启用状态时也保持关闭。新版工程的淡入淡出和舒展均默认关闭，可在属性列表按物理轨道或单条字幕开启。已有显式启用的设置能正常读取。 | 已覆盖，无需跟进。 |
| 给补丁发行说明和附带的系列功能说明分设标题。 | MSW 按当前标签提取更新条目，并附下载和使用信息，现有格式足以表达补丁范围。 | 无需跟进。 |
| 给 CHANGELOG 和开发日志索引配置 `merge=union`。 | 这是上游多分支同时追加日志时用的合并规则。MSW 逐项吸收上游改动，在工作分支维护自己的变更日志和版本段落。 | 无需跟进。 |

[上游 ASS 与发行说明修复](https://github.com/Moyf/moys-asr-workflow/commit/4411be2a7decdd9c8f3194e27fcc3a1dfe5a0de0) · [上游文档合并规则](https://github.com/Moyf/moys-asr-workflow/commit/5fb70d8875f6eef553acf3b262eff56a01f67818) · [MSW 旧 ASS 后端默认值](../maw/ass_styles.py#L176) · [MSW 旧 ASS 前端默认值](../web/editor-utils.js#L4342) · [MSW 工程动画默认值](../maw/msw/subtitle_animation.py#L6) · [MSW 操作说明](WORKFLOW.md#L45) · [MSW 发行说明生成](../scripts/prepare_release_notes.py#L28)

MAW 的 `>>文字<<` 和 `{{文字}}` 是已有的单句动画标记。MSW 在「属性列表 → 动画」保存轨道默认值与单条字幕的覆盖值，继续沿用这一入口及现有正文 Markdown 语法。

## 验证

- Python 45 项通过。覆盖 ASS 方案、工程样式、字幕动画、描边和阴影不透明度、行内样式。运行 `python -m unittest tests.test_ass_styles tests.test_project_subtitle_style tests.test_subtitle_animation tests.test_ass_opacity tests.test_inline_markup`，设置 `PYTHONPATH=tests`。
- Node 304 项通过。运行 `node --test tests/test_editor_utils.mjs tests/test_subtitle_animation.mjs tests/test_inline_markup.mjs`。
- 用合成旧工程和 v4 工程调用预览与烧录的 ASS 生成入口。缺少动画设置的字幕全程静态，两个入口生成的 ASS 一致。保存过的旧样式保留 120/200 毫秒淡入淡出。在 v4 工程仅为一条字幕显式开启后，重新读取工程仍只有这一条带动画。
- Chromium 3 项通过。运行 `playwright test tests/e2e/subtitle-animation.spec.mjs --grep "track presets are role-specific|fixed fades use equal seconds|typewriter keeps the first glyph fixed"`。覆盖绝对时间淡入淡出、按轨道继承及保存重开，并用 v1.11.1 随包 FFmpeg 核对逐字动画预览与 ASS 烧录画面。
- 本轮验证范围为 Windows 源码筛选及上述对照用例。安装包和其他系统的发布回归未运行。
