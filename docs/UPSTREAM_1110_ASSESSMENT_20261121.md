# MAW v1.11.0 跟进筛选

MAW 于 2026-11-09 发布 v1.11.0。从上游 `cc7e7448` 到 `cedb5bfd` 有 58 个提交，涉及 328 个文件，包含发布文档、官网与开发工具。以 MSW v1.10.0 发布提交 `e68eea53` 为产品基线，按两个 MAW 标签之间的差异及 MSW 当前行为筛选。v1.11.1 及之后的功能和修复留待各自版本核对。 [MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.11.0) · [上游标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.10.0...v1.11.0) · [MSW v1.10.0](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.10.0)

| 建议顺序 | 范围 | 依据 |
| --- | --- | --- |
| A | Soniox v6 | MSW 的界面和缺省模型均为 v5，官方已启用兼容的 v6。 |
| B | 去空隙试听、第三方字体、启动器关闭 | 分别复现漏音、脏别名未纠正、关闭时仍向 WebView 推送事件。 |
| C | 旧式双语暂停预览 | 复现开关改变后副字幕仍留在暂停画面，可随 B 一起小修。 |
| 可选 | 波形原位快编、成组文本规则、透明图片字幕 | 有独立使用价值，适合单独确定交互与验收范围。 |

## 建议纳入 MSW v1.11.0

### A　Soniox v6

- 加入 `stt-async-v6` 并设为未指定模型时的默认值，统一 Launcher、编辑器 ASR、CLI 和示例配置。旧 v5 模型 ID 继续可用，避免破坏已保存的识别预设和命令。Soniox 表示 v5 在 2026-12-15 停用后会自动路由到 v6。现有接口、密钥、语言、说话人和上下文参数可复用。v6 对金额、编号等内容的文本格式会变化，实施时用标点、中英混排、说话人和词时间码样例覆盖结果解析。 [Soniox 模型与迁移说明](https://docs.soniox.com/stt/models) · [上游模型更新](https://github.com/Moyf/moys-asr-workflow/commit/565d59c0177e63fa69526349245592cedebc6378) · [MSW 模型目录](../maw/gui_config.py#L435)

### B　试听、字体与退出

- **去空隙试听漏音。** 合成音频仅在 1.025～1.9 秒有声音，移除区间为 1～2 秒。Chromium 从 0.5 秒播放，两轮各两次在约 0.82 秒让页面主线程忙碌 600 ms，最终每次都只定位到 2 秒一次，但 AudioWorklet 测到峰值约 0.134～0.137。两次无忙碌对照分别测到无声和漏音。MSW v1.10.0 的定位去重因此仍有价值，后续可在现有源音频图上按音频时钟提前调度边界静音，在跳转完成后复位。覆盖显式试听、快进跳转、倍速、播放／暂停、配音保护和无媒体时间轴。输出时间线继续使用现有间隙映射。 [MSW 播放定位](../web/editor.js#L15075) · [MSW 音频调度](../web/msw-audio-transport.js#L131) · [上游 #327](https://github.com/Moyf/moys-asr-workflow/pull/327)
- **第三方字体名。** 构造同时有 Windows Unicode 正常名和 Macintosh 旧脏名的字体名称表。MSW 把脏名登记为已安装字体，`resolve_font_family` 对旧工程中的脏名原样返回，即使同一字体已有正常的家族名。建议共用字体名记录筛选，按语言与平台优先可靠记录，保留只有 Macintosh 记录的字体。坏名字可作为安全的旧工程解析别名，在选择器、预览度量和 ASS 导出时归到正确字体。沿用现有全名、PostScript 名和按需字体发现。 [MSW 字体目录与解析](../maw/msw/subtitle_fonts.py#L43) · [上游 #333](https://github.com/Moyf/moys-asr-workflow/pull/333)
- **关闭 Launcher。** 用正在退出的 WebView 模拟对象复现，启动器事件队列中有一条消息时，`EventPump.shutdown` 仍调用 `evaluate_js`，该次调用失败会把异常送回关闭路径。上游列在 v1.11.0 说明，其实现已存在于 MAW v1.10.0，也适合补到 MSW。关闭流程应先停止界面事件投递、丢弃排队界面消息，再取消识别／批量任务和关闭会话，并继续由现有落盘日志记录故障。模拟测试覆盖迟到消息，真实 WebView2 的退出时间留待实机验证。 [MSW 事件泵](../maw/gui_web.py#L475) · [MAW 关闭实现](https://github.com/Moyf/moys-asr-workflow/blob/v1.11.0/maw/gui_web.py#L3193)

### C　旧式双语暂停预览

- 浏览器关闭固定轨道呈现后，用合成主副字幕复现。暂停时关闭双语，副字幕在当下和 120 ms 后都仍可见，下一次播放刷新才消失。MSW 固定轨道已在渲染结束后刷新暂停画面，可给旧式双语开关补同一刷新，并覆盖撤销、重做。MAW 的基础双语叠加字幕波形布局另有专用实现，MSW 使用物理 S 轨布局，优先针对现有布局的真实回归修复。 [MSW 双语开关](../web/editor.js#L4103) · [固定轨道刷新](../web/editor.js#L6985) · [上游暂停刷新](https://github.com/Moyf/moys-asr-workflow/commit/2776338fcd19c71dbfd6aa5cc8800b359c381507) · [上游布局 #334](https://github.com/Moyf/moys-asr-workflow/pull/334)

## 有需求时单独实施

- **波形原位快编。** MSW 已能双击波形字幕进入现有编辑区，原位气泡可减少视线和焦点移动。建议以后复用字幕 ID、文本草稿与拆分事务，先做快速改单条和 Tab 切换，再评估字词编辑。快捷键继续由 MSW 定义，并验证锁轨、绑定、不同编辑焦点和撤销。整块悬浮提示的开关可以独立评估，现有开关只控制附加详情。 [MSW 波形入口](../web/waveform.js#L5137) · [上游原位快编 #352](https://github.com/Moyf/moys-asr-workflow/pull/352)
- **多步骤文本预设。** MSW 的「查找并编辑」已整合替换、整理和剧本，Launcher 的固定处理已经支持按顺序应用替换规则。上游值得借鉴的是把一组操作保存、复用和分享。若有反复清理需求，可在「查找并编辑」增加规则组，按当前选区预览最终差异、单次应用并可撤销。 v4 多轨、绑定和字词时间码规则继续走现有写入入口。 [MSW 查找并编辑设计](PLAN_FIND_EDIT_PANEL_20261028.md) · [MSW 后处理流程](POSTPROCESS_PIPELINE.md) · [上游 #339](https://github.com/Moyf/moys-asr-workflow/pull/339)
- **FCP 7 XML 透明图片字幕。** MSW 已有 FCP 7 XML 文本对象和 OTIOZ，多出一项透明 PNG／WebP 素材交付，对剪辑软件中保留外观有价值。若确实需要，复用 MSW 轨道范围、样式编译与输出时间映射，先验证目标剪辑软件对透明素材、相对路径和帧边界的导入。上游 v1.11.1 另修了 Resolve 导入全片离线，这会影响后续选型。 [MSW FCP 7 XML](../web/editor-utils.js#L5967) · [上游图片字幕 #348](https://github.com/Moyf/moys-asr-workflow/pull/348) · [MAW v1.11.1 兼容修复](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.11.1)
- **烧录诊断。** MAW 的慢盘修复把其下载连接的 2 秒写超时放宽至 10 秒。MSW 的编辑器下载走一次性下载凭据和本机文件流，该路由没有相同的 2 秒写超时，按原问题独立复现后再调整。可按需把 FFmpeg 失败的有界、脱敏摘要写入现有日志，界面继续显示可操作的错误反馈。 [MSW 下载处理](../maw/msw/api.py#L308) · [MSW 导出错误处理](../maw/msw/audio_render.py#L37) · [上游 #351](https://github.com/Moyf/moys-asr-workflow/pull/351)

## 沿用现有流程

- **损坏媒体波形。** MSW 波形读取时有独立 stderr 消费线程，避免上游的管道堵塞条件，并覆盖成功解码时保留波形。继续沿用 MSW 的多音轨和取消处理。去空隙音频也使用不同的采样计划与混音补齐路径，此次未复现 MAW 的越界报错。若实际选中轨尾部有可听差异，再按所选音轨长度核对，不统一缩短保留区间。 [MSW 波形读取](../maw/waveform.py#L323) · [MSW 音频计划](../maw/msw/audio_plan.py) · [上游 #341](https://github.com/Moyf/moys-asr-workflow/pull/341) · [上游音频导出修复](https://github.com/Moyf/moys-asr-workflow/commit/32a8ef923ff83138b338fc275cd1e0b6310bf7ef)
- **单句 ASS 样式和恢复空隙。** MSW 的属性列表已支持单条外观预设、单条覆盖和继承；空隙可在 MSW 自己的标记与保留范围体系中恢复。继续沿用这两个入口。 [MSW 样式与空隙](WORKFLOW.md) · [上游空隙恢复 #328](https://github.com/Moyf/moys-asr-workflow/pull/328)
- **CLI 烧录、画面缩略图、表情包成片增强、官网与开发工具。** 本版优先现有字幕编辑和导出流程。CLI 烧录需要明确脚本化交付场景，表情包背景和字左放置依赖尚未采纳的成片流程。预览空白处取消调整框可作为现有播放器交互的小优化，先明确它与播放切换和选区的优先关系。开发看板、便携产物、官网重构和 ESM 迁移留在上游。两标签之间的 Python 锁文件仅变化项目版本。 [MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.11.0)

本轮运行字体、波形、Soniox 与音频导出 91 项 Python 用例，均通过。另用合成媒体及模拟窗口复现上述差异。Soniox v6 的实际云端响应、目标剪辑软件导入和真实 WebView2 退出仍需针对性验证。
