# 导出样式、试听同步与工具窗反馈

基线：51d7f33。已有 `.test-appdata/` 保留。本轮用户授权实施 1–4；随后五个问题先检查并回答，不自行扩大为修改任务。

| 编号 | 内容 | 状态 | 处理决定／证据 |
| --- | --- | --- | --- |
| A | 选项名旁统一提示图标，收纳其他工具窗长说明 | 已修复 | 已实现悬浮／焦点显示、点击固定、Esc 关闭；覆盖视频／音频／OTIO 导出、拼接合并、缩放偏移；浏览器验证通过。 |
| B | 字幕烧录样式与实际导出预览 | 已修复 | 样式落入 preview.burn_subtitles，主副独立 ASS 样式；原图分辨率渲染后缩放预览，支持五秒样片；浏览器实际 PNG、五秒 MP4、字号保存及真实视频独立红／绿色像素验证通过。 |
| C | 四种试听音量同步方式 | 已修复 | 前后端共享六组监听快照夹具通过；真实 WAV 验证一次叠加与精确静音；浏览器验证锁定、恢复手动值及真实提交快照。 |
| D | 拼接／合并字幕工具窗统一风格 | 已修复 | 已使用处理面板表单、紧凑操作区和提示图标；算法不变。900×600 浏览器验证无横向溢出，截图已检查。 |
| Q1 | 播放器总音量含义及入口 | 仅说明 | player.volume/muted 影响原声及配音监听；底部喇叭旁 media-volume 滑块。播放器容器小于 520px 时现有 CSS 隐藏入口。 |
| Q2 | 源音量改变后的波形反馈及性能 | 仅说明 | 复用已有峰值，显示时乘幅度即可；无需解码、重生成缓存。建议可选跟随源试听增益、显示 dB，限幅提示，合并可见行重绘。频谱颜色不冒充波形振幅反馈。 |
| Q3 | 新工程另存为的含义 | 仅说明 | createProjectCheckpoint 调用 persistence.saveAs(newProject:true)，确定新 .mosp 路径和服务绑定；正常打开已有工程不要求另存新文件。 |
| Q4 | 粘贴后丢失着色 | 仅说明 | cloneCueForClipboard 删除 color_ref，但未把组头解析出的颜色写成副本独立 color；引用成员会丢色，显式独立颜色仍保留。确认为遗留 Bug；本轮未修改剪贴板逻辑。 |
| Q5 | 缩放偏移提示过多、时间码自动修复 | 仅说明 | applyScalePercent/applyOffsetDelta 每次滚轮或连发均 flashHint。applySubtitleTimeEdit 只写段起止，不同步 items；buildJson 的 repairCurrentProjectTimings 会修正字词时间缺失、倒序／重叠、零时长。建议面板内状态、手势结束一次反馈／撤销，明确主副与选中范围，同步时间真源后收敛修复提示。本轮仅收纳操作说明，不修改该机制。 |

## 验证记录

使用隔离应用数据、合成媒体、本机服务；不读取个人 .env，不调用真实收费服务。分别记录单元、浏览器、真实 FFmpeg 与未验证边界。

- 第一轮 Python：字幕样式、音频计划、真实音视频与编辑器资源共 46 项通过；Node 音频计划 21 项通过。
- 第一轮浏览器：8/9 通过。真实帧接口已返回 PNG，但字幕列表显示刷新误触预览失效；已改为比较字幕时间、文字和禁用状态，B 项复测中。没有把失败记录作通过。

## 最终验证与边界

- `python -m unittest test_msw_subtitle_style test_msw_audio_plan test_msw_video_render test_msw_audio_render test_msw_audio_exports test_editor_assets test_project_contract`：91 项通过。真实 FFmpeg 验证音量、精确静音、主副独立着色、裁切和分段烧录；接口验证令牌、绑定与非法样式拒绝。
- `node --test tests/test_msw_audio_render.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs`：通过。首次在沙箱内无法启动 Python XML 子进程导致相关测试失败；指定项目解释器并在允许的执行环境重跑后全部通过。
- `editor-video-export.spec.mjs` 九项均已通过（最初八项通过，修正预览失效后该项复测通过）；最终补跑字幕样式、主副合并联动、偏移撤销三项全部通过，共覆盖 11 个不同浏览器用例。
- 修正字号 HTML 步长与下限不对齐导致合法整数百分比被拒绝的问题，浏览器断言 8% 正确存为 86.4 的 1080p 基准字号。
- 已从源码运行 `edit.py --blank`；生成产物资源测试、改动 JS 语法和 `git diff --check` 通过。已更新 schema、音视频导出说明与 CHANGELOG。
- 截图人工检查：紧凑合并窗口、字幕样式／实际帧预览；测试运行使用隔离数据和合成媒体。未执行收费 ASR/TTS 调用、小时级压力、跨系统或打包发行版验收。
- 使用本机字体，缺少字体时由 libass 回退；从播放器复制的是基础样式，最终以帧预览／样片为准。便携 HTML 没有本机服务时不提供后台渲染。
- 本轮未提交或推送；保留原有 `.test-appdata/`。Q4 与 Q5 的算法改进为后续建议，无实施项处于待处理或进行中。

后续实施：用户已授权 Q2／Q4／Q5 及相关编辑与保存反馈调整，并要求统一提交推送。完成情况见 `TEST_FEEDBACK_EDITING_SAVE_20260920.md`；本记录上述结论保留为当时的验证基线。
