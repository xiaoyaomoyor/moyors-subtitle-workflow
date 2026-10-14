# 所选字幕定位与保存

本轮接通普通编辑器中的“轨道默认／所选字幕”，保持现有样式面板和主副分组。

| 项目 | 状态 | 决定／验证 |
| --- | --- | --- |
| 实际选区、自动轨道单条定位、恢复继承 | 已修复 | 普通编辑器只写实际选区；无选区／锁定禁用入口，轨道预设不清除单条覆盖。 |
| 稳定锚点、预览／ASS／烧录一致 | 已修复 | 九种锚点原位写回后 ASS 完全一致；旧位置转换保留组排布依据。完成实际视频导出，下载 MP4 解码后确认指定位置存在字幕像素。 |
| 保存重开、撤销、多选及画面拖动 | 已修复 | 所选定位 Chromium 6 项通过：真实本机保存重开、多选间距、精确渲染拖动、暂停持有、取消与键盘一次撤销重做、预览偏好恢复；未选中伙伴和绑定不变。 |
| 回归、生成产物、服务 | 已修复 | 全量 Node 631/631；Python 2094 项（2067 通过、27 跳过）；浏览器共 26 个不同用例通过。产物重新生成，8250 已重启，实际接口验证布局契约 8 与锚点／base 字段。 |

基线：my-feature，1a19abd；当前任务开始前无相关源码改动。

用户追加“最后补齐画面拖动、多选、撤销和导出验证”：纳入本轮同一交付。画面拖动直接平移 libass 事件，保留字体、描边与动画；拖动中不写工程，松开一次提交，等待新 ASS 时保留当前位置，避免切换近似文本或松手闪回。新增多选拖动真实指针、暂停持有、Esc、键盘撤销／重做与 MP4 下载解码检查。

实现涉及 `msw-track-preview.js`、`msw-project-style-ui.js`、前后端轨道位置验证与共用排布；预览布局契约升为 8，后端已重启，用户 Ctrl+F5 加载页面即可使用。

专项命令：`python -m unittest discover -s tests -p test_selected_position.py`；`node --test tests/test_flat_editing.mjs tests/test_track_presentation.mjs`；`playwright test tests/e2e/selected-subtitle-position.spec.mjs --project=chromium`。浏览器使用合成蓝色视频与虚构双语字幕，无外部识别／翻译／配音调用。

扩大回归首轮：识别应用与 ResizeObserver 更新后立即读取结果导致两项竞态失败；改为等待同一预期结果。旧轨道定位用例未配置其专用 FFmpeg 路径，补齐 `MSW_TEST_FFMPEG` 后复验，11 项全部通过。识别／翻译／配音／保存／导出流程通过；最终定位、控制条避让与生产流程 14 项全部通过，另有普通样式工具栏 1 项通过，共 26 个不同用例。代码审阅额外补齐：定位只校验实际选中轨道的锁定，不因未修改的绑定伙伴锁定而拒绝；合并定位按时间最早字幕保留，不依赖选择顺序。

最终验证：`uv run --frozen python -m unittest discover -s tests -p 'test_*.py'`（设置 PYTHONUTF8，FFmpeg 经 PATH 提供，不覆盖测试 mock）；旧位置 base 补充后重跑位置／v4 校验 14 项通过。`node --test tests/test_*.mjs` 最终 631/631。浏览器命令覆盖 `selected-subtitle-position`、`preview-controls-avoidance`、`flat-production-flow`、`subtitle-track-presentation` 和 `flat-production` 中的样式工具栏用例。`uv run --frozen python edit.py --blank`、JS 语法与 `git diff --check` 通过。

无未完成的功能项或阻塞。未验证 Firefox／Safari、实际云端服务及所有外部播放器；本次使用 Windows Chromium、本机 libass、FFmpeg 和隔离的模拟处理服务。生成截图、视频和日志保存在工作区外层检查目录，不纳入仓库；原有 debug.log、.test-appdata、output 保留。按既有授权在 my-feature 提交并推送，不修改 main、不创建 PR。
