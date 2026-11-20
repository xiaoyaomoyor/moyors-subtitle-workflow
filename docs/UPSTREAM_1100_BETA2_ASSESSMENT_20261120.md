# MAW v1.10.0-beta.2 跟进筛选

MAW 于 2026-10-24 发布 v1.10.0-beta.2。上游标签从 `87810635` 到 `200406ff` 共 131 个提交，涉及 304 个文件，含多次前端模块迁移。以 MSW `my-feature` 的 `713d3caa` 为基线，其中 beta.1 候选提交 `f1aada1e` 已通过 Windows 发布预检，MSW 的公开正式版仍是 v1.9.0。本轮核对两个上游标签之间的改动和 MSW 的实际行为。[MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.10.0-beta.2) · [标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.10.0-beta.1...v1.10.0-beta.2) · [MSW beta.1 预检](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44698922289)

| 顺序 | 建议跟进 | MSW 筛选依据 |
| --- | --- | --- |
| A | 依赖安全更新 | `certifi`、`urllib3` 锁定版本低于修复线，下载运行环境也需覆盖。 |
| B | 空隙跳过、Launcher 错误提示、多句表情包预览 | 三项均用合成输入复现，各自沿用现有播放、工具和工程数据。 |
| C | 字词时间码保留、查找并编辑性能 | 旧工程的字词与正文标点或空白不一致时，轻改会丢字词时间码。单条改动会重扫全部查找结果。 |
| D | 字体别名、macOS 系统字体 | Windows 实测已登记别名找不到对应度量，macOS 字体目录核对发现缺项。 |

## A　安全更新

- 主锁文件是 `certifi 2026.7.22`、`urllib3 2.7.0`。建议纳入 `certifi >= 2026.10.19`、`urllib3 >= 2.8.0`，重新冻结 MSW 的主程序与可选运行环境依赖。urllib3 修复涵盖 HTTPS 代理 TLS 和流式响应。回归普通下载、云端请求和代理。 [MSW 锁文件](../uv.lock) · [证书信任公告](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576) · [urllib3 发布说明](https://github.com/urllib3/urllib3/releases/tag/2.8.0) · [上游 #294](https://github.com/Moyf/moys-asr-workflow/pull/294) · [上游 urllib3 更新](https://github.com/Moyf/moys-asr-workflow/commit/3276013581d5ee59033dfc700508fd40d7b6c2f5)
- 按实际分发链核对 Windows 内嵌 Python 与 get-pip、macOS/Linux venv、CI 和源码安装用的 uv。Python 社区公告列出 pip 26.2.2 和 uv 0.13.6。需要升级的 runtime 按 MSW 自己的版本号更新清单，现有本地 ASR、MOSS、OCR 分别为 8、2、3。MAW 对应的清单号码有其自己的历史。验收应包含已安装环境升级，并保留模型、缓存和自定义目录。 [MSW 运行环境安装](../maw/runtimes/base.py) · [本地 ASR 环境清单](../maw/runtimes/local_spec.py) · [MOSS 环境清单](../maw/runtimes/moss_spec.py) · [OCR 环境清单](../maw/runtimes/ocr_spec.py)
- MSW 锁定 `hf-xet 1.6.0`，该版本源码锁的 `rustls-webpki 0.103.13`、`webpki-root-certs 1.0.6` 落在公告影响范围。实施时核验实际发布的各平台 wheel 和 TLS 后端。选择确认修复的发行包，或在受影响的模型下载路径禁用 Xet 后验证普通路径与 ModelScope 回退。 [hf-xet 源码锁](https://github.com/huggingface/xet-core/blob/v1.6.0/hf_xet/Cargo.lock) · [rustls-webpki 公告](https://rustsec.org/advisories/RUSTSEC-2026-0382.html) · [webpki-root-certs 公告](https://rustsec.org/advisories/RUSTSEC-2026-0383.html)

## B　播放与工具修复

- **空隙跳过。** 用当前编辑器两个播放更新函数和真实空隙判断函数，令模拟播放器持续报告它还在 1,000～2,000 ms 空隙内且正进行定位。每个入口调用三次，向同一个终点共发出六次定位请求。建议在 MSW 的原生播放器与虚拟音频时间轴各自的入口做同一空隙定位去重，处理定位完成、失败、手动跳转、暂停和预览空隙等复位条件。保留音频贴片、去空隙及片段预览行为。真实解码时的停滞仍需专项回归。 [MSW 播放更新](../web/editor.js#L15063) · [MSW 音频时间轴](../web/msw-audio.js) · [上游 #306](https://github.com/Moyf/moys-asr-workflow/pull/306)
- **Launcher 路径联动。** 先给现有「压制字幕」工具模拟挂载视频，再在字幕路径为空时点运行，成功触发红框。主流程随后赋有效后缀的 `clip.srt` 并执行实际跟随回调，字幕值更新，红框仍在。建议在自动值实际改变时清除对应字段的旧校验反馈，顺手核对媒体和对齐工程字段。保留用户手动填入的路径。 [MSW 路径联动](../web/launcher/postprocess.js#L529) · [上游 #304](https://github.com/Moyf/moys-asr-workflow/pull/304)
- **多句表情包预览。** MSW 的多句普通绑定把同一素材引用赋给各句，导出按各句生成独立实例。合成首句 1～2 秒、后句 3～4 秒时，预览在 1.5 秒显示，2.5 秒及 3.5 秒均不显示。建议预览复用各句区间，再核对「拓展表情包时长」的显式连续区间和存量工程。上游的扩首句为连续区间会改变普通绑定的语义，MSW 宜保留间隔。 [MSW 预览区间](../web/editor.js#L15775) · [MSW 多句绑定](../web/editor.js#L20613) · [上游 #292](https://github.com/Moyf/moys-asr-workflow/pull/292)
- **拆分与撤销。** Chromium 验证了 MSW 的正文修改及撤销刷新 ASS，也通过了波形 B、右键拆分与撤销重做、两个已有的字词时间码漂移拆分用例。列表 B 按鼠标位置拆分、列表外按播放头拆分及撤销均通过各自断言，列表切点闪标的断言连续两次失败。此处建议作为小修单独查闪标。波形 B 和右键拆分沿用 MSW 自己的拆分入口及最短时长规则。上游的独立字词轨道接缝命中区和「实际画面」快照刷新适用于 MAW 的界面。 [MSW 拆分入口](../web/editor.js#L8885) · [MSW 浏览器用例](../tests/e2e/click-behavior.spec.mjs#L527) · [上游 #306](https://github.com/Moyf/moys-asr-workflow/pull/306)

## C　正文编辑与查找性能

- **保留已有字词时序。** 「查找并编辑」应用草稿已用 `applyTimedTextEdit`，也能处理常见错字和同源句内样式移除。合成正文 `Hello world`、字词码文本为独立 `Hello` 和 `world` 时，改为 `Hello, world!` 会清空字词码。将空格放回字词文本即可保留两词的原起止时间。建议补一层可验证的空白、标点漂移对齐。词序、内容与候选区间一致时才挽救，明确改写或匹配歧义沿用现有回退。回归带句内样式、中英文及剧本导入后应用。 [MSW 应用草稿](../web/msw-find-edit.js#L200) · [MSW 字词时序映射](../web/editor-utils.js#L1550) · [上游 #284](https://github.com/Moyf/moys-asr-workflow/pull/284)
- **大工程改单条草稿。** MSW 已用 Worker 查找、按视口渲染结果。用当前计划函数和 3,000 条合成结果，改变一个草稿触发 3,000 次正文处理。建议缓存逐字幕处理结果，针对草稿和规则变化分别失效，再量测四种编辑形式的输入响应。MAW 的测时对应其独立纯文本编辑器。上游另一项波形性能优化针对切换字词轨道；MSW 可在实测波形行几何或视口重建过多时评估其 ResizeObserver 去重思路。 [MSW 编辑计划](../web/msw-find-edit.js#L295) · [上游 #305](https://github.com/Moyf/moys-asr-workflow/pull/305)
- **续跳查找。** 可选。沿用现有的字幕、波形高亮与定位，新增显式「上一处／下一处」或 F3／Shift+F3 后，可把光标放到匹配的正文。需兼顾整段视图偏移和剧本可选中复制的只读信息行，按普通按钮定位时保留现有焦点表现。 [MSW 查找定位](../web/msw-find-edit.js#L147) · [上游 #284](https://github.com/Moyf/moys-asr-workflow/pull/284)

## D　字体兼容

MSW 字体选择器已有中文名、多语言与别名，扫描 TTC 时会遍历全部字体面。后端布局和预览字体来源仅以字体族名建索引。本机验证了目录能列出 `ArialMT`，该名称在后端无度量，同一字体 `Arial` 正常。建议统一在加载、布局与 ASS 生成时解析规范名及别名，优先精确字体族名，处理冲突并保留粗体/斜体独立字段与旧工程存值。macOS 补有目标的 AssetsV2 系统字体子目录，继续使用当前的缺字提示。需在 macOS 实机核验。上游的字体 TTC 循环修复、实际画面本地视频换绑及 Canvas 大字号斜体裁边针对各自实现。若 MSW 的 ASS 预览出现对应症状再按现用渲染路径诊断。 [MSW 字体目录](../maw/msw/subtitle_fonts.py) · [MSW 字体度量](../maw/msw/track_presentation.py) · [上游 #289](https://github.com/Moyf/moys-asr-workflow/pull/289) · [上游 #295](https://github.com/Moyf/moys-asr-workflow/pull/295) · [上游 #303](https://github.com/Moyf/moys-asr-workflow/pull/303)

## 已覆盖与暂缓项

- **MASS 弱化与斜体、逐句缩放定位、放大出现、最近工程。** MSW 已采用 `%%弱化%%`、`//斜体//` 及统一开关，单条字幕已有缩放手柄和样式继承，字幕动画的变换可用毫秒指定起终倍率，启动器首页已有最近工程与全部工程。建议沿用这套界面和语法。若后续频繁用到放大出现，可用现有变换做一个预设。 [MSW 句内样式](../web/msw-inline-markup.js) · [MSW 字幕动画](../maw/msw/subtitle_animation.py) · [MSW 工程首页](WORKFLOW.md#L709) · [上游 #275](https://github.com/Moyf/moys-asr-workflow/pull/275) · [上游 #277](https://github.com/Moyf/moys-asr-workflow/pull/277) · [上游 #278](https://github.com/Moyf/moys-asr-workflow/pull/278) · [上游 #290](https://github.com/Moyf/moys-asr-workflow/pull/290)
- **工程 LUFS 与匹配。** MSW 的试听音量与原声、配音混音独立，保存的项目响度测量和目标匹配是本轮真实的新能力。需要统一成片响度时再独立设计，接入现有音频计划与多种视频导出，保留试听与工程增益的区分。 [MSW 音频时间轴](../web/msw-audio.js) · [上游 #285](https://github.com/Moyf/moys-asr-workflow/pull/285)
- **额外的实际画面预览、表情包烧进成片、启动器直烧。** MSW 已有自己的播放器图层和工程输出。此次只建议修复表情包显示区间，延续此前推迟的成片功能。 [MSW 导出流程](WORKFLOW.md) · [上游 #292](https://github.com/Moyf/moys-asr-workflow/pull/292)
- **字词轨道、缩略图轨道、AI 对比页面、口播清理与 ESM 改造。** 相关修复依赖 MAW 的界面、流程或构建。建议维持 MSW 当前波形布局、对比工具和按请求装配的方式。动态英文提示可在有具体漏译时按现有字典补齐。媒体探测的真 FFprobe 测试可以吸收测试方法，已有发布预检继续沿用。 [上游 #298](https://github.com/Moyf/moys-asr-workflow/pull/298) · [上游 #280](https://github.com/Moyf/moys-asr-workflow/pull/280) · [上游 #266](https://github.com/Moyf/moys-asr-workflow/pull/266) · [上游 #274](https://github.com/Moyf/moys-asr-workflow/pull/274) · [上游 #299](https://github.com/Moyf/moys-asr-workflow/pull/299)

## 验证范围

- 核对远端标签和本地同一提交范围，复现空隙请求、查找计划、字词时序、Launcher 路径提示和多句表情包区间，并核对 Windows 字体目录与后端度量。
- Chromium 使用合成工程、合成媒体及本机测试服务，共七项通过，一项列表切点闪标失败且专项复跑结果一致。初次因环境限制未连上本机测试服务，使用回环权限后完成。实机媒体的空隙播放、macOS 字体及模型下载留待实施后验收。
