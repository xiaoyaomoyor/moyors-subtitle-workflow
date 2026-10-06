# 字幕预览后续修正（2026-10-06）

## 基线与范围

- 基线 `2c0378d`，分支 `my-feature`，原有 `.test-appdata/` 保持不动。
- 仅实现本轮三个明确修改项；每行字符数换行只核对现状并提出布局建议。
- 完成验证后按持续授权提交并推送 `origin/my-feature`。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 样式标记仅在主／副字幕预览开启时显示 | 已修复 | 在更新及失效事件中同步标记可见性。浏览器验证主／副开关四种组合及迟到渲染更新均通过。 |
| 副字幕在上未生效 | 已修复 | 真实画面复现未绑定、不同时间字幕被成组避让覆盖顺序；已改为呈现时聚合重叠区间，连续字幕复用位置，不写入绑定。普通／旧样式、绑定／未绑定双语的实际画面均通过。 |
| 主副间距允许负值 | 已修复 | 输入及前后端统一为 -240…240；负值缩短距离，极限压缩不反转上下顺序。分离旧样式主副图层，保持背景低于文字，避免 libass 再次避让覆盖负间距；画面、序列化、撤销与重载验证通过。 |
| 每行字符数换行 | 仅说明 | 现有 Shift+Enter 手动换行；自动折行依字体、字号、左右边距／可用宽度，没有按每行 N 字符显示的入口。ASR 最大字数是生成分句，列表字数阈值是筛选，均不是视觉换行。建议加入字幕样式→通用，主副分别设置，预览与 ASS／烧录共用；本轮不新增。 |

## 阶段验证

- 第一轮 Node 样式／呈现 13/13，Python 样式／层级 16/16 通过。
- 第一轮浏览器工程样式 8/10 通过；两个失败均为旧样式负间距触发的额外避让，普通样式、标记显示、预设和保存验证通过。补充对应修复后重新验证。

## 最终验证

- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_project_style.mjs tests/test_subtitle_presentation.mjs tests/test_subtitle_layers.mjs`：356/356 通过。
- `python -m unittest tests.test_project_subtitle_style tests.test_subtitle_layers_dg`：17/17 通过。涵盖不同时间的未绑定连续字幕、-240／-12／24 间距、主上／副上、自动／手动避让、单轨／双轨输出、工程保存校验以及便携 ASS／Python 烧录一致性。
- Playwright（Edge／Chromium）：`project-subtitle-style`、`media-settings-layout`、`ass-export`、`video-first-frame` 四个文件 29/29 通过。普通／旧样式及绑定／未绑定四种组合各验证两种上下顺序及正负间距，浏览器和 FFmpeg 坐标偏差小于 3 px；负值下距离确实缩小。人工查看合成截图确认副字幕在上与负间距效果。
- 已重新生成 `blank-editor.html`，JavaScript 语法检查、UTF-8／LF 与 `git diff --check` 通过。
- 完整 Python 套件：1977 项，4 个失败、1 个错误、74 项跳过。失败名单与上一轮一致：`test_msw_output_layout` 缺失恢复夹具、`test_waveform` 的旧 DATA 字面量断言，以及 `test_gui_workflow`／`test_media`／`test_msw_beta3_cache` 的本机目录偏好相关断言；此前基线复核证据见 `TEST_FEEDBACK_SUBTITLE_ARRANGEMENT_20261006.md`。未扩展修改这些既有问题。
- 本轮无阻塞的修改请求。使用合成媒体和临时工程验证；不访问或修改用户工程、配置。不同实际字体的行高与自动折行仍取决于渲染度量，CSS 回退为近似预览。
