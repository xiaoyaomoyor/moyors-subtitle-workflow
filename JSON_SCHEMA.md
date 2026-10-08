# 字幕工程文件规范（`.mosp` / `.json`）

本文档定义 MSWE（Moyor's Subtitle Workflow Editor）、`edit.py` 生成的 `.edit.html` 以及 `blank-editor.html` 共同接受的工程文件格式。工程文件内容是 UTF-8 JSON；`.mosp` 是当前默认和推荐的扩展名，`.json` 作为旧工程与兼容输入/输出扩展名继续支持。

用途：让任意来源（ASR、第三方模型生成、人工手写）的 JSON 都能直接被编辑器加载、编辑、再导出。

适用版本：对应 `edit.py` / `generate_subtitle_qwen_api.py` 当前实现。

编辑器独立媒体工作流可在 `msw.source_audio_index` 保存所选源音轨的逻辑序号（整数 0–255），与容器 `stream_index` 区分；缺省沿用波形缓存的 `audio_track`，再缺省为 0。播放代理与后台分析任务保存在本机可重建缓存，不能替代工程的 `media` 原素材引用。

---

## 一、顶层结构

新写出的工程使用顶层 `schema: "moy.asr.project.v1"`，与 MAW beta.2 的工程版本约定兼容。缺少此字段的旧 `.mosp`／`.json` 仍可读取，在内存规范化及下一次保存时补上版本；单纯打开或恢复不会改写原文件，也不会移动旧媒体或素材目录。

显式提供 `schema` 时必须是上述字符串。未知版本、空字符串、`null` 或其他类型一律拒绝，不能通过保存把它们静默降为 v1。Python 工程边界、统一写出、文本匹配脚本及编辑器打开／拖入／恢复／另存为回载均执行版本检查；浏览器先验证再切换工程与任务关联。顶层版本和可选 `msw.schema` 分别验证，不能互相替代。

浏览器保存保留 `language_source`、`split_mode`、`timestamp_granularity`，以及未识别的可选顶层 JSON 字段；切换工程时替换这一组扩展字段。`msw` 是已知字段，始终按当前编辑状态验证并写出，不使用加载时的旧快照。其他已知字段继续按各自规范重建，因此这里不承诺任意未知嵌套字段都能保留，也不承诺 MSW 配音工程经其他编辑器保存后仍完整保真。

```json
{
  "schema": "moy.asr.project.v1",
  "media": "...",
  "language": "en",
  "language_source": "detected",
  "split_mode": "word",
  "timestamp_granularity": "word",
  "model": "...",
  "media_metadata": {
    "video_fps": 29.97002997002997,
    "video_fps_ratio": "30000/1001",
    "audio_tracks": [
      {
        "audio_index": 0,
        "stream_index": 1,
        "codec": "aac",
        "channels": 2,
        "sample_rate": 48000,
        "language": "zh",
        "title": "中文",
        "default": true
      }
    ]
  },
  "timebase": { "unit": "milliseconds", "fps": 30 },
  "sticker_root": "...",
  "waveform": { ... },
  "gap_remove": { ... },
  "script_alignment": { ... },
  "workspace": { ... },
  "preview": { ... },
  "segments": [ ... ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema` | `string` | 新输出必填；旧输入可省略 | 固定为 `moy.asr.project.v1`；显式未知值拒绝，不自动降级 |
| `segments` | `array<object>` | **必填** | 字幕段数组。**缺失或不是数组时，页面直接弹「文件格式不对，缺少 segments 字段」并拒绝加载** |
| `media` | `string` | 否 | 媒体文件路径（绝对/相对均可）。便携 HTML 会在“打开工程”时用它的文件名匹配同一次选择的媒体；只选工程文件时会提示用户继续选择媒体。浏览器安全限制下不能自行读取该路径或跳转其目录。服务器编辑器可按该路径自动加载 |
| `language` | `string` | 否 | 统一后的语言代码，如 `zh`、`en`、`ja`；无法确定时为空字符串。仅用于显示与选择切句计量方式 |
| `language_source` | `string` | 否 | 语言来源：`detected`（模型返回）、`hint`（用户提示）、`inferred`（从文字脚本推断）或 `unknown`（未知） |
| `split_mode` | `string` | 否 | 切句计量方式：`continuous`（字符型，如中文）或 `word`（单词型，如英文） |
| `timestamp_granularity` | `string` | 否 | 时间码粒度：`char`、`word`、`segment` 或 `unknown`。只有整段 start/end 的模型使用 `segment`；这类工程的字幕段可以没有 `items` |
| `model` | `string` | 否 | ASR 模型名，如 `qwen3-asr`。仅用于显示 |
| `media_metadata` | `object` | 否 | 源媒体元数据。可包含视频 `video_fps`（1–240 的数字）、`video_fps_ratio`（FFprobe 原始帧率比例字符串）和 `audio_tracks` 音轨清单；缺失时按旧工程处理 |
| `timebase` | `object` | 否 | 字幕编辑时间基准：`unit` 为 `milliseconds` 或 `frames`，`fps` 范围为 1–240。缺失时按毫秒模式兼容读取 |
| `sticker_root` | `string` | 否 | 表情包根目录绝对路径。打开工程时会覆盖编辑器内的 `STICKER_ROOT` |
| `waveform` | `object` | 否 | 可丢弃的紧凑波形缓存。由 `edit.py` 或浏览器自动生成；不影响字幕语义 |
| `gap_remove` | `object` | 否 | 可逆的空隙移除决定。保留原始媒体/字幕时间，仅描述导出与跳过播放时使用的派生时间轴 |
| `script_alignment` | `object` | 否 | 录制对齐工具写入的选择记录；不改变 MSWE 的字幕与时间码语义 |
| `overlay_track` | `object` | 否 | 与上游兼容的独立叠加字幕轨 `{enabled, segments}`；关闭时保留数据，与副字幕及配音贴片不同 |
| `transcription_warnings` | `array<string>` | 否 | 识别结果的可读警告，如部分句子缺少可靠时间范围；不包含密钥，不改变字幕或时间码语义 |
| `workspace` | `object` | 否 | 编辑器工作区：四个功能区的窗口布局与显示状态；不影响字幕和波形缓存。服务器版也可使用独立的本机命名工作区库跨工程复用 |
| `preview` | `object` | 否 | 预览呈现设置。含 `preview.subtitle`（主字幕预览框与样式）、可选的 `preview.extension_subtitle`（拓展字幕样式）和 `preview.sticker`（表情包预览层）。不影响字幕时间与文本 |

`media_metadata.video_fps` 是生成工程时从源视频读取的媒体 FPS，仅作为编辑器切入帧模式时的默认值；它不替代编辑器自己的 `timebase.fps`，用户仍可在全局设置中修改。旧工程没有 `media_metadata` 时继续使用编辑器原有默认值。`video_fps_ratio` 用于保留 `30000/1001` 这类非整数帧率的原始比例。

`media_metadata.video_width` 与 `video_height` 是兼容 MAW beta.4 的可选视频尺寸，提供时必须成对出现且均为正整数；缺失时仍接受旧工程。探测只补缺失值，不覆盖工程已有 FPS 或所选音轨。

顶层 `loudness` 是 `moy.asr.loudness.v1` 响度运行态缓存：由匹配源媒体和所选音轨的 `.quapeaks` 响度层生成，包含整文件 `bin_count/channels/audio_track/max/mean/rms/p95/source`，数值为线性 RMS，不能当作峰值或 dB。普通 `.mosp` 保存时与波形缓存一起剥离；缓存缺失不影响字幕编辑。

`media_metadata.audio_tracks` 是从源容器读取的音轨清单。`audio_index` 是音频流内部的从 0 开始顺序，`stream_index` 是源容器中的 FFmpeg stream index；其余字段用于保留编码、声道、采样率、语言、标题和默认标记。编辑器导出 OTIO 时会为每条清单建立独立的 `Audio` 轨道，在达芬奇使用的 `Resolve_OTIO.Channels` 中写入源音轨/声道映射，并在 `moy` 元数据中保留对应的 stream index。旧工程缺少该字段时继续生成一条兼容的音频轨道。

`timebase` 是字幕编辑器的时间基准，不改变媒体本身的时间单位。`unit: "milliseconds"` 保持旧行为；`unit: "frames"` 时，拖动、边界调整、方向键和 A/D 微调使用独立的帧字段，`fps` 决定帧与实际媒体时间的换算。为兼容旧工具，`start` / `end` 及字词时间码仍始终保存为整数毫秒；帧模式额外保存成对的 `start_frame` / `end_frame` 字段。帧时间码显示采用较通行的非丢帧格式 `HH:MM:SS:FF`，其中 `FF` 是当前秒内的帧号。

`media_metadata.duration_ms` 是可选的非负整数毫秒源媒体时长（最多 7 天），用于没有波形缓存时恢复时间轴。它不包含配音贴片延长的编排时间。`segments: []` 和空音频贴片数组是合法工程；20 秒空编辑视图不写成媒体时长，也不生成伪峰值。

`media_metadata.selected_audio_track` 是可选的非负整数，表示源媒体中从 0 开始的逻辑音轨编号，与 `audio_tracks[*].audio_index` 对应。新输出写入此公共字段；读取优先级为公共字段、旧 `msw.source_audio_index`、旧内嵌缓存的 `audio_track`、容器默认轨（没有默认标记时为 0）。公共字段与旧 MSW 字段均存在但冲突时，保留原值并提示用户确认源音轨；确认前不能发起 ASR。显式切轨同步两字段。源轨编号与临时单声道 WAV 的解码轨 0 分开处理。

### 1.0 工程文件扩展名

- 转写器和 Launcher 默认生成 `.mosp`；命令行的 `--json` 参数名称为历史兼容名称，含义是“同时生成工程文件”。
- `.mosp` 文件不是新的二进制容器，而是普通 UTF-8 JSON，方便脚本、版本控制和其他工具读取。
- 编辑器、服务器和桌面入口都继续接受 `.json`。打开旧 `.json` 工程时可以原扩展名保存，也可以通过“另存为”改成 `.mosp`。
- 服务器覆盖保存会保留当前扩展名，并先创建同目录备份：`project.mosp.bak` 或 `project.json.bak`。
- `.workspace.json` 是可选的独立工作区迁移文件，不是字幕工程文件；Resolve JSON、保留区域 JSON 等导出文件也不应重新作为工程打开。

### 1.1 waveform 波形缓存

`waveform` 不是工程真源，而是从媒体派生的性能缓存。第三方生成 JSON 时可以完全省略；编辑器加载媒体后会补算。

从 beta.3 同步起，普通 `.mosp` / `.json` 保存、另存为、下载、恢复快照及对齐导出剥离顶层 `waveform`、`spectral`、`waveform_reapeaks`。只处理持久化副本，保留运行态同源同轨缓存、真实媒体时长和 MSW 配音素材。旧工程内嵌缓存仍可读取；便携 `.edit.html` 继续内嵌运行所需峰值。

新公共缓存写入 `_msw` 或按输出设置写入 `视频名_msw`：`.quapeaks` 使用 QPK1 容器保存 REAPER 形状、可选频谱和自研波形层；无内核时自研峰值使用纯 Python 的 MPK1 `.mopeaks`。默认轨使用 `<媒体完整名>.quapeaks/.mopeaks`；其他轨使用 `<媒体完整名>.track-<audio_index+1>.quapeaks/.mopeaks`。无后缀文件属于容器默认轨，不能一律视作第 0 轨。只将精确匹配轨的层用于绘制和静音检测，缺失时重建该轨或显示占位。

读取还会检查媒体旁、旧 MSW/MAW 目录、旧 `.waveform.json` 和 `.ReaPeaks`；不自动移动、删除或批量改写旧文件。只读媒体目录可退回本机按完整源路径隔离的缓存。受管导入的后台任务使用版本 2 的 `.mopeaks` 产物，仍能读取旧任务清单对应的 JSON 产物；HTTP 下发格式继续使用下面的运行态 JSON 载荷。

```json
{
  "schema": "moy.asr.waveform.v1",
  "encoding": "i8-minmax-base64",
  "peaks_per_second": 100,
  "sample_rate": 1000,
  "division": 10,
  "peak_count": 123456,
  "duration_ms": 1234560,
  "data": "base64 编码的 [min,max] int8 峰值对",
  "audio_track": 0,
  "source": {
    "name": "audio.wav",
    "size": 987654321,
    "modified_ms": 1784000000000
  }
}
```

- `data` 每个峰占 2 字节：有符号 int8 的最小值、最大值，整体再做 base64。
- **时间刻度**：第 i 个峰覆盖 `[i × division / sample_rate, (i+1) × division / sample_rate)` 秒。做"峰值序号 ↔ 毫秒"换算时必须用 `sample_rate / division`；`peaks_per_second` 只是给人看的近似值。老缓存可以没有这两个字段（此时退化为 `peaks_per_second`），但只要出现一个就必须成对且合法，否则视为无效载荷。
- `.ReaPeaks` 派生的载荷里 `sample_rate / division` 多数情况下是**分数**（16 kHz 媒体 `division=53` → 301.8868 峰/秒）。把它取整当刻度会按比例缩放整条时间轴，错位随媒体时长线性累积。
- `source` 用于缓存失效；媒体文件名、字节大小或最后修改时间变化时会重新计算。
- `audio_track` 可选，表示生成缓存时使用的、从 0 开始的音频流顺序；旧内嵌载荷缺失时按 0 兼容。`waveform`、`spectral` 和 `waveform_reapeaks` 必须使用同一值；新文件按本节前述容器默认轨规则命名，旧 `.ReaPeaks` 的显式 `.track-N` 后缀继续兼容。
- 默认密度 100 峰/秒。三小时音频约产生 108 万峰、2.88 MB base64 字符串。
- 未识别的 `schema` / `encoding` 会被忽略，不阻止工程加载。
- 六个命令行生成器的 `--with-waveform` 生成独立 `.quapeaks`，内核不可用时回退 `.mopeaks`；GUI 转写默认开启波形生成。运行态仍使用上述 payload，普通工程落盘剥离它。
- 编辑器缺少有效波形时可后台提取并保存二进制缓存，不再新写 `.waveform.json`；旧 JSON 继续原位读取。缓存可重建，生成失败或取消不影响字幕与配音编辑。

### 1.1a spectral 频谱缓存（可选）

`spectral` 同样是媒体派生的性能缓存，只用于编辑器把波形按主频染色。它不是真源，第三方生成 JSON 时可以完全省略；服务器加载媒体时若找到精确匹配的 `.quapeaks` 或旧 `.ReaPeaks`，会解析频谱层并在运行态下发。

```json
{
  "schema": "moy.asr.spectral.v1",
  "encoding": "u16-freq-density-base64",
  "sample_rate": 48000,
  "division": 2400,
  "peak_count": 72000,
  "data": "base64 编码的 [freq,density] uint16 对",
  "audio_track": 0,
  "source": {
    "name": "audio.wav",
    "size": 987654321,
    "modified_ms": 1784000000000
  }
}
```

- `data` 每个频谱采样占 4 字节：主频 uint16（低 15 位有效，0–32767）、密度 uint16（低 14 位有效，0–16383），整体再做 base64。
- `division` 是时间对齐用的每采样样本数：`sample_rate / division` 即每秒频谱采样数。`sample_rate`、`source` 与主波形一致。
- **生成时机**：`--with-waveform` 生成 `.quapeaks` 的 wave 层；同时勾选 Launcher 的频谱选项或传入 `--with-spectral` 才额外计算频谱 FFT。`--with-spectral` 必须与 `--with-waveform` 一起使用。生成由 Rust 内核 `quapeaks` 与 FFmpeg 完成，numpy 不参与；缺内核时仅保留 `.mopeaks` 自研波形。编辑器后台解析保留进度和取消，对齐工具只读取已有缓存。
- 解析器读取 QPK1 及 REAPER 的 `RPKN`/`RPKL` 文件，取匹配 `peaks_per_second` 分辨率的 spectral 层（`-(int)'s'` 标记）；未知版本、无 spectral 层、文件缺失或损坏时降级，不影响编辑器。
- 未识别的 `schema` / `encoding` 会被忽略。浏览器端在 `decodeSpectralPayload` 校验这两字段与 `data` 长度（`peak_count * 4`）。
- **与主波形层的对齐关系**：第 i 个频谱采样与第 i 个峰是同一时刻，两者共用 `division`，**不需要任何索引偏移**。频谱层的 `peak_count` 通常比配对的 wave 层少若干（44.1 kHz 真机文件少 7、16 kHz 少 25），因为末尾的 FFT 窗口填不满——缺口在尾部而非头部（用已知时刻的窄带脉冲实测：48 kHz 下频谱响应中心 bin 4207.5，wave 层最强 bin 4207）。因此这段尾部只是不上色，编辑器按索引越界处理，不得据此平移染色层。
- 多声道媒体取声道 0 的主频/密度，服务端与浏览器端一致。

### 1.1b waveform_reapeaks 波形层（可选）

`waveform_reapeaks` 保留旧字段名，表示 `.quapeaks` 或 `.ReaPeaks` 最细 wave 层转成的 `moy.asr.waveform.v1` payload（字段与 §1.1 完全一致）。它是**默认的波形形状来源**：没有可用层时回退原生 `waveform`（1000 Hz 重采样）；用户可在波形设置中切换两种来源。

```json
{
  "schema": "moy.asr.waveform.v1",
  "encoding": "i8-minmax-base64",
  "peaks_per_second": 301.886792,
  "sample_rate": 16000,
  "division": 53,
  "peak_count": 1510,
  "duration_ms": 5006,
  "data": "base64 的 [min,max] int8 对",
  "audio_track": 0,
  "source": { "name": "audio.wav", "size": 441044, "modified_ms": 1786328355571 }
}
```

- 由服务器从精确匹配轨的 `.quapeaks` / `.ReaPeaks` 解析最细 wave 层得到；刻度是 `sample_rate / division`（约 300 峰/秒），整除时 `peaks_per_second` 写成整数，否则保留精确比率，**绝不取整**——取整会把整条时间轴按比例缩放，错位随媒体时长线性累积。
- 容器描述实际解码的文件。优先解码完整源媒体；仅源媒体失败时才尝试派生音频，派生缓存使用派生文件路径和指纹，不能冒充源媒体缓存。头部 provenance 比较 `(mtime, size)` 的低 32 位；运行态载荷保留完整 `source` 签名。不同解码文件的自研峰值不能注入同一容器。
- **多声道合并**：本载荷把 `.ReaPeaks` 各声道合并成一条包络（min 取各声道最小、max 取各声道最大），与浏览器端 `decodeReapeaksFile` 完全一致。只取单一声道会让"双单声道"素材（人声只在右声道）画成直线。
- 当前形状来源被切换时，波形绘制与「按音量移除空隙」的检测共用同一份包络，不会出现"看到的是一条曲线、按另一条曲线判断"。
- 缺失可用容器或没有 wave 层时该字段不出现，编辑器回退原生波形。
- 与 `spectral` 同源，均为可丢弃缓存，非真源。
- 没有 `spectral` 数据时，编辑器会自动取消并禁用“频谱颜色”开关；后台读到合法频谱后重新启用该开关。

### 1.2 workspace 工作区

`workspace` 使用独立 schema `moy.asr.editor.workspace.v1`。一个工作区 = **窗口布局**（“视频、当前字幕编辑区、字幕列表、波形”四个功能区的停靠方式与尺寸）+ **显示状态**（波形显示模式与偏好、字幕列表/编辑区的显示开关）。保存或恢复工作区时两部分一起生效。

```json
{
  "schema": "moy.asr.editor.workspace.v1",
  "preset": "custom",
  "selectedPreset": "cinema",
  "waveformMode": "basic",
  "waveformSettings": { "visibleSeconds": 20, "secondsPerRow": 10, "rowHeight": 120, "waveformScale": 1, "side": "left", "disabledDisplay": "dim", "showGroupBadges": true, "dragPlayhead": true },
  "editorDisplay": { "cueListShowIndex": true, "cueListShowTime": true, "cueListShowSticker": false, "cueListShowCharcount": true, "cueEditorShowNavigation": false, "cueEditorShowTimeActions": true, "cueEditorShowSticker": false },
  "splitPercent": 60,
  "columnPercent": 58,
  "rows": [42, 27, 31],
  "tree": {
    "type": "split",
    "direction": "row",
    "ratio": 58,
    "children": [
      {
        "type": "split",
        "direction": "column",
        "ratio": 42,
        "children": [
          { "type": "module", "id": "player" },
          {
            "type": "split",
            "direction": "column",
            "ratio": 46.55,
            "children": [
              { "type": "module", "id": "panel" },
              { "type": "module", "id": "cues" }
            ]
          }
        ]
      },
      { "type": "module", "id": "wave" }
    ]
  }
}
```

- `preset` 是**渲染器**，决定这份窗口布局如何绘制：`classic`（标准堆叠网格）、`wave-right`（右侧整列波形网格）或 `custom`（由 `tree` 渲染；「字幕列表编辑」「大荧幕布局」与用户自定义工作区都走这条路）。未知值回退到 `wave-right`。
- `selectedPreset` 记录用户最后在**工作区下拉框**选择的项：内置工作区为 `classic` / `wave-right` / `three-fold` / `cinema`（大荧幕布局），本机命名工作区为 `saved:<名称>`。它与 `tree` 一起保存，使内部以 `custom` 渲染的工作区在重开工程后仍显示用户所见的名称。
- `waveformMode` 可为 `multi`（多行）或 `basic`（单行）。工作区中存在该字段时随恢复一并切换；缺失时保持当前浏览器设置。
- `waveformSettings` 保存波形区数值与显示偏好：基础模式窗口长度、多行每行长度及高度、振幅、左右侧、禁用字幕显示、分组徽章与拖动播放头。可选布尔值 `followSourceGain` 控制波形显示高度是否跟随源音频试听增益，新安装默认关闭；仅绘制时应用增益，不修改峰值缓存或媒体。字段缺失时保持浏览器本机设置。
- `waveformSettings.waveformScaleAuto` 为工程级自动响度定标开关，与上游 beta.4 同名同义。显式 `false` 保留手动 `waveformScale`；显式 `true` 在有效响度缓存到达后拟合。旧 MSW 工程已有振幅数值而没有此标志时补为 `false`，新工程默认 `true`；无有效响度层时不猜测振幅。手动增减振幅会关闭自动模式，“响度适配”可重新开启；`followSourceGain` 仍独立作用于绘制。
- `editorDisplay` 保存“字幕列表显示”和“字幕编辑显示”两组开关。它只包含工作区可见性，不包含导出、自动保存或快捷键等全局偏好。
- `splitPercent` 是 classic 网格中多行波形与字幕列表比例，范围会被限制在 35–75；它与工作区一起导出，因此拖动后可撤销、复用。
- `columnPercent` 是 `custom` 渲染器最外层左右分栏的比例，范围会被限制在 30–75。
- `rows` 是左侧“视频 / 当前字幕 / 字幕列表”的相对高度，编辑器会自动归一化并保证每区可用的最小高度。
- `tree` 是 `custom` 渲染器的二叉 split tree。`type: "module"` 是功能区叶子；`type: "split"` 的 `direction` 为 `row`（左右）或 `column`（上下），`ratio` 是第一个子区的比例。
- 布局编辑模式拖动标题条时，中央区域会显示“对换”预览；靠近上/下/左/右边沿会显示对应半区的“插入”预览。松开后目标叶子会被拆成新的横向或纵向 split，可继续嵌套。
- 工程文件导出会包含 `workspace`。单文件 HTML 在「工作区配置 ▾」提供“导出工作区配置 / 导入工作区配置”，以 `.workspace.json` 文件显式迁移该结构；服务器版的「保存工作区」则把同一结构保存到用户本机：内置工作区保存为该预设的本机覆盖版（可重置回默认），自定义工作区保存到命名工作区库（可另存、删除），均可供其他工程复用；该操作不会写回字幕工程文件。
- 拖动模块、拖动任一布局分隔条、导入和重置工作区都会进入统一的 `Ctrl(Cmd)+Z` 撤销栈；「编辑布局」中可用「重置工作区」恢复当前内置工作区的默认状态。

### 1.3 gap_remove 空隙移除

`gap_remove` 不重写字幕时间或原媒体。当前 MSWE 使用 `retention_mode: "locked"`：固定表示**锁定标记**，不是保留声音；所有现存空隙仍参与播放跳过、去空隙导出及空隙内字幕筛选，受配音保护约束。

```json
{
  "schema": "moy.asr.gap_remove.v1",
  "detector": "audio_gate",
  "retention_mode": "locked",
  "retained_ranges": [{"start": 2000, "end": 3000}],
  "minimum_ms": 400,
  "threshold_db": -28,
  "hysteresis_db": 2,
  "lead_in_ms": 120,
  "lead_out_ms": 80,
  "skip_playback": true,
  "operation_mode": "boundary_drag",
  "generation_mode": "audio_gate",
  "generated_sources": ["audio_gate"],
  "cleared": false,
  "gaps": [
    {"start": 1000, "end": 2000, "removed": true, "retained": false},
    {"start": 2000, "end": 3000, "removed": true, "retained": true},
    {"start": 3000, "end": 4000, "removed": true, "retained": false}
  ]
}
```

- `retained_ranges` 是固定标记的真源，整数毫秒 `{start,end}`，重叠或相接区间合并。固定区间不依赖检测结果存在：重新生成即使没有匹配区段，固定范围仍留下。最终 `gaps` 按固定边界切分，派生 `retained` 布尔值；全部写出 `removed: true`，使播放和导出继续使用同一有效范围。`removed` 是兼容字段，界面不再提供“待移除”状态。
- 每次从音频空隙面板生成时，先替换全部未固定空隙，包括另一生成方式、台本对齐与手工编辑产生的未固定标记，再投影独立的固定范围。手动移动或缩放不会自动设置固定。固定标记不能移动、复制拖动或缩放；相邻未固定标记的拖动边界不会挤动它。取消固定后恢复编辑。
- `provenance` 仍支持 `moy.asr.gap_provenance.v1`：`sources` 下的 `script_alignment`、`audio_gate`、`subtitle_outside`、`content_outside`，以及 `manual_overrides` 和兼容 `legacy` 数组。条目可有 `id/source/start/end/removed`。锁定模式下来源只用于兼容重建，不决定固定状态与外观；编辑后可重新物化来源投影。旧的 `move`、`boundary_resize` 等记录仍可读取。
- 没有 `retention_mode` 的上游工程，原 `removed: false` 表示不参与移除的恢复区。MSWE 打开时将这些淡化区间迁为固定标记，原 `removed: true` 迁为未固定标记；随后保存为上述新模式。这一迁移会让旧淡化标记也参与跳过和去空隙导出；原文件在用户保存前不改写。共享核心对没有显式启用锁定模式的旧调用者保留原语义。旧客户端不保证保留 MSWE 的锁定字段。
- `minimum_ms` 为 100–60000，默认 400；音量检测在扣除两侧保留量后检查最小时长。`threshold_db` 为 -96–0，默认 -28；`hysteresis_db` 为 0–30，默认 2，界面“阈值缓冲”：音量达到阈值算有声，低于阈值减缓冲值才回到静音。
- `lead_in_ms`／`lead_out_ms` 是空隙起点／终点保留的音频毫秒数，0–2000，默认 120／80，界面“句尾保留／句首保留”；与标记固定状态不同。零值有效。生成基于原始波形、主字幕或全部内容占用范围，不累计收缩。音量检测只扫描内部静音；两种外区段方式包括媒体首尾，可能含声音，只要求扣除保留量后时长为正。
- `operation_mode` 兼容 `none`、`boundary_drag`（默认）、`middle_drag`、`boundary_and_middle`，映射面板的独立复选框。Alt 点击切换标记固定状态；空白处 Alt 拖动添加未固定空隙，中键可添加、Alt＋中键固定已有范围。来源统一使用普通空隙样式，固定标记淡化，不常驻显示文字。
- 右键及批量操作支持固定／取消固定、删除、仅删除未固定、转时间选区。转换将范围并入已有时间选区，删除对应空隙及锁定记录；一次撤销同时恢复转换前的选区和空隙。时间选区与 Ctrl/Cmd+Shift 框选共用运行态，不作为新工程字段持久化。
- `disable_coverage_percent`／`disable_remaining_ms` 默认 80%／300ms。筛选同时检查可移除范围覆盖率和剩余时长，扣除配音保护，包含固定标记覆盖的字幕。只有执行按钮才禁用主字幕及绑定副字幕，支持撤销。
- `generation_mode` 保存 `audio_gate`（默认）、`subtitle_outside` 或 `content_outside`；`generated_sources` 记录生成完成状态，即使无结果也保留，重新生成后只记录本次方式。`cleared` 默认 false，用于区分未生成、无匹配与清空。清空全部时同时清除来源、固定范围与生成记录。设置与结果随工程保存、撤销恢复。
- 台本对齐的 Python 往返保留锁定字段，并在来源重建后重新物化固定区间。来源重建不能使固定标记失效。
- `subtitle_outside` 计算全部主字幕块之外的区段，禁用块仍占用时间。`content_outside` 计算所有主字幕、副字幕轨、旧叠加字幕和音频贴片占用范围并集的补集；禁用、静音及关闭轨道不影响占用。音频贴片按源裁剪采样数与素材采样率计算结束点，非整数毫秒向外取整；只在原媒体时长内生成，素材引用缺失时中止且不替换旧标记。
- 菜单“字幕外区段设为空隙”立即使用 `subtitle_outside` 和零句首／句尾保留量，不打开面板、不改写面板选定方式及保留量。替换未固定标记，保持固定范围，整次操作一步撤销。`generated_sources` 记录实际生成来源，允许与面板当前方式不同。
- 固定状态继续使用 `retention_mode`、`retained_ranges` 和 `retained` 字段，无需迁移已保存工程；界面不再用“保留”指代锁定状态。

### 1.3a script_alignment 录制对齐记录

`script_alignment` 是录制对齐 Server 写入的可选诊断与选择记录，不替代 `segments` 或 `gap_remove`。候选、选择和 Extra 范围可以包含 `sourceSlices`，用于记录一个源字幕段内的 item 子范围：

```json
{
  "sourceCueIndex": 19,
  "sourceCueId": "main-020",
  "start": 46390,
  "end": 48230,
  "itemStart": 0,
  "itemEnd": 12,
  "sourceText": "目前支持画面上的这些模型"
}
```

选中的 `incomplete` 候选默认不会进入保留区间；用户明确手动启用后，选择记录会保留原始 `incomplete` 分类。完整的 `match` 候选默认进入保留区间；用户也可以手动禁用当前已采用的候选，让它从保留区间中移除。两类覆盖都会保留在选择记录中：

```json
{
  "candidateActions": {
    "candidate-001-01": "keep",
    "candidate-002-01": "discard"
  },
  "manuallyEnabledCandidateIds": ["candidate-001-01"],
  "manuallyEnabledLineIds": ["line-001"],
  "manuallyDisabledCandidateIds": ["candidate-002-01"],
  "manuallyDisabledLineIds": ["line-002"],
  "blockedIncompleteLineIds": []
}
```

`candidateActions` 只记录用户对已选候选的显式覆盖：`incomplete` 使用 `keep` 手动启用，完整 `match` 使用 `discard` 手动禁用；`manuallyEnabledCandidateIds` 表示实际解除自动禁用的候选，`manuallyDisabledCandidateIds` 表示从默认保留中排除的完整候选，`blockedIncompleteLineIds` 表示仍会被禁用的不完整文稿行。这样可以区分识别结果、自动建议和用户确认。

当源段只有部分 item 被采用时，导出的工程会在相应 item 边界拆分字幕段；未采用部分设置 `disabled: true`，其间的时间同时写入 `gap_remove.gaps`。没有有效 `items` 时，录制对齐工具退回到源字幕段边界。

候选和已选记录还可以包含 `internalSkips`，表示一个 take 内部自动识别出的重复源段：

```json
{
  "kind": "skip-source",
  "reasonCode": "repetition",
  "sourceText": "双语字幕",
  "sourceSlices": [{
    "sourceCueIndex": 5,
    "sourceCueId": "main-006",
    "start": 16309,
    "end": 17030,
    "itemStart": 0,
    "itemEnd": 4,
    "sourceText": "双语字幕"
  }]
}
```

当前 MVP 只在相邻的完整源字幕段之间启用这一规则：文本归一化后完全相同，或具有足够长的共同开头并且后一个片段前有明显停顿。规则既适用于候选内部，也适用于候选外的连续未认领片段；默认舍弃前一个、保留后一个，因此不会把近似改口错误地列为新的 Alternative。导出时会从候选的保留范围扣除 `internalSkips`，相应字幕段设为 `disabled: true`，时间写入 `gap_remove.gaps`。

候选的 `alternativeGroupId` 表示同一文稿行的局部录制组；相邻候选之间默认最多相隔 `10000ms`，且最多跨过 `8` 个源字幕段，限制值记录在对齐结果的 `settings.alternativeMaxGapMs` 与 `settings.alternativeMaxCues` 中。不同组的完整命中不会自动作为 `Alternative` 禁用，而会以 `kind: "extra"`、`reasonCode: "distant-match"` 进入可确认范围，默认保留。

### 1.4 preview 预览呈现

`preview.project_style`（可选）是工程正式字幕样式快照，结构为
`{schema: "msw.subtitle-style.v1", name, main, secondary, animations}`。
`main`／`secondary` 使用 ASS 样式库的样式字段，字号、描边和边距以
1080 高画布为基准；`animations` 使用原 ASS 方案的 `fad`／`fade`／`move`／`t`。
ASS 导出、播放器工程预览和视频烧录默认读取这个快照，不实时引用用户预设库。
`legacyBurn` 仅用于迁移，保存原 `preview.burn_subtitles`，直到用户明确转换高级样式。

`main`、`secondary` 还可分别包含 `wrapMode: "auto"|"characters"`（缺省 `auto`）和 `charsPerLine: 1..200`（整数，缺省 20）。自动模式沿用渲染器按画面宽度换行；按字数模式仅对呈现快照中的字幕正文插入换行，保留手动换行。汉字、英文字母、标点、空格各计 1；组合附加符、常见 ZWJ 表情及旗帜组合保持完整。原字幕 `text/items`、时间码和 SRT 不被改写，自动添加的说话人前缀不计入正文上限；画面过窄时渲染器仍可提前换行。主副分别随工程、自定义快照和样式预设保存；布局计算使用已换行的呈现文本，预览、ASS（含副轨单独输出、去空隙版本）及烧录共享规则。

可选 `pairLayout: {order: "main-above"|"secondary-above", gap: -240..240}` 指定主副排列和组内间距（整数，1080p 基准）。`gap` 是估算文字行框之间的附加距离，不是字形可见边缘的像素距离；0 不增加额外间距，负值使行框重叠。单行行框高度按 `fontSize × 1.2 × scaleY / 100` 计算，多行及同轨重叠继续累加；未声明纵向缩放的旧烧录样式使用 100%。字号、字体自身留白、描边和换行均可能使相同 gap 的可见距离不同。负值压缩间距，允许视觉重叠；极限压缩受行高约束，防止颠倒上下顺序。缺省保留已有位置及排布；用户调整时更新上下位置，保持下方轨道的底部锚点。绑定主副字幕在预览和导出中使用相同的行高估算及组内间距；未绑定的主副字幕按相交区间的连通组仅在呈现时成组，不写入绑定，首尾恰好相接不视为重叠。组内连续字幕复用位置，不将整段序列堆成多行。主副组内排列独立于重叠组的自动避让开关，单轨输出保留该轨在双语组中的位置；旧样式显式排列时主副使用不同 ASS 图层，避免 libass 再次避让覆盖间距，所有背景保持在文字下方。直接编辑对齐／垂直边距会退出明确主副排列，沿用手动设置。

`preview.project_style_custom`（可选）保存同格式的最近手动编辑快照；`preview.project_style_selection`（可选）为 `current` 或预设 ID（1–160 位字母、数字、下划线、连字符）。切换预设不覆盖自定义快照，选择“当前自定义”恢复它；尚无快照时以当前外观建立。选择与快照随工程保存、撤销、恢复，输出仅使用 `project_style`。

新工程及默认样式的 `pairLayout` 为 `{order: "main-above", gap: 0}`；主／副垂直边距分别为 96／48。已有快照及旧样式迁移不自动套用这组新默认值。

`preview.style_migration` 记录 `{version: 1, source: "ass"|"burn", presets, notice}`；
`presets` 保留原 ASS 和预览外观。首次加入工程样式并覆盖旧文件前，在同目录
创建短文件名 `.msw-style-backup-<hash>.mosp`，不覆盖已有备份。
旧字段继续保留供兼容读取；有 `project_style` 时正式输出优先使用它。
校对预览仅选择跟随工程或已有预设，选择保存在本机偏好中，不覆盖 `project_style`；旧独立自定义预览配置自动转存为用户预设，不丢弃已调参数。
本次导出选择其他预设时仅写入任务快照，工程原样式不变。

`preview` 记录预览呈现层的设置，与字幕时间/文本完全解耦。目前定义两个子几何：`preview.subtitle`（字幕预览框，编辑器里 `#overlay`）与 `preview.sticker`（表情包预览层，编辑器里 `#sticker-overlay-layer`），都是在播放器区域内的几何，以 player-wrap 矩形的**归一化分数**存储，因此在播放器缩放和跨机传输后仍然一致。

```json
{
  "subtitle": { "x": 0.1, "y": 0.76, "width": 0.8, "height": 0.16, "font_size": 32, "font_family": "yahei", "color": "#ffffff" },
  "extension_subtitle": { "font_size": 30, "font_family": "yahei", "color": "#ffd34d" },
  "sticker": { "x": 0.73, "y": 0.04, "width": 0.24, "height": 0.3 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `x` | `number` | 是 | 左上角横坐标，占播放器宽度的分数，范围 `[0, 1]` |
| `y` | `number` | 是 | 左上角纵坐标，占播放器高度的分数，范围 `[0, 1]` |
| `width` | `number` | 是 | 预览框宽度，占播放器宽度的分数，范围 `[0, 1]` |
| `height` | `number` | 是 | 预览框高度，占播放器高度的分数，范围 `[0, 1]` |
| `font_size` | `number` | 否 | 字幕预览字号，单位 px，范围 `[12, 96]`；缺失时使用原来的响应式默认字号 |
| `font_family` | `string` | 否 | 字幕预览字体族：内置键 `default`、`yahei`、`hei`、`song`、`sans`，或本机字体族名称（最长 128 个字符） |
| `background_color` | `string` | 否 | 字幕预览背景色，6 位十六进制颜色 `#RRGGBB`；缺失时使用黑色 |
| `background_alpha` | `number` | 否 | 字幕预览背景不透明度，范围 `[0, 1]`；缺失时使用 `0.65`，设为 `0` 时隐藏背景 |
| `color` | `string` | 否 | 六位十六进制颜色，如 `#ffffff`；主字幕默认白色，拓展字幕默认黄色 `#ffd34d` |
| `color_underline` | `boolean` | 否 | 播放预览按字幕颜色快照给文字加下划线以区分不同颜色的字幕；缺失时视为 `true`（默认开启），设为 `false` 时关闭下划线。编辑器仅在关闭时写入该字段 |
| `color_style` | `string` | 否 | 主字幕的颜色显示样式：`underline`（默认）、`text`、`shadow`、`stroke`。`color_underline: false` 关闭按分组颜色显示；不更改 segment 颜色或文字 |
| `speaker_labels` | `object` | 否 | 颜色说话人映射。`mapping_enabled` 控制映射（默认 false），`enabled` 控制播放器名称显示（旧工程缺省 false，新建工程显式 true），`names` 为五种颜色到姓名的映射（每名最多 64 字符），`separator` 最多 16 字符；名称与分隔符不允许控制字符。兼容旧 `enabled: true` 且缺少 `mapping_enabled` 的工程 |
| `preview.extension_subtitle` | `object` | 否 | 拓展字幕样式；同样支持 `font_size`、`font_family`、`color`，没有字号时默认比主字幕小 2px |

### 约束

- `x`、`y`、`width`、`height` 四个字段都必须是数字（不接受字符串、布尔），且落在 `[0, 1]`。
- 若存在 `font_size`，必须是 `[12, 96]` 内的数字；若存在 `font_family`，必须是内置字体键或非空本机字体族名称，最长 128 个字符，不能包含控制字符；若存在 `background_color`，必须是 `#RRGGBB` 格式；若存在 `background_alpha`，必须是 `[0, 1]` 内的数字。
- 若存在 `color`，必须是 `#RRGGBB` 六位十六进制颜色；拓展字幕样式不包含独立几何，沿用 `preview.subtitle` 的预览框。
- 若存在 `color_underline`，必须是布尔值；其他取值视为缺失并按默认 `true` 处理。
- 盒子必须留在播放器内：`x + width <= 1` 且 `y + height <= 1`。
- 编辑器额外强制最小可读尺寸 `width >= 0.20`、`height >= 0.08`（这是编辑器 UX 钳制，非数据契约的硬校验；导入时会被编辑器再钳制）。
- `preview` 缺失或 `preview.subtitle` 缺失时按**旧工程**处理，编辑器使用默认几何 `{ x: 0.1, y: 0.76, width: 0.8, height: 0.16 }`——字幕带占 76%→92%（底部留 8%），宽度 80% 居中。
- `preview.sticker` 缺失时同样按旧工程处理，使用默认几何 `{ x: 0.73, y: 0.04, width: 0.24, height: 0.3 }`（右上角）。两个几何共用同一套归一化与钳制规则。
- 该几何只移动/缩放预览框容器；内部文字 `<span>` 仍保持居中与药丸样式，`segments[*].start/end/items[*].start/end` 永不被此几何改动。

### 1.4a overlay_track 叠加字幕

`overlay_track` 与上游 beta.5 使用相同公共结构：`{"enabled": false, "segments": []}`。字段缺失兼容旧工程；关闭轨道只影响显示与导出，不删除其字幕。

- 叠加段与主轨采用相同的整数毫秒、字词、帧字段、禁用、颜色及表情包契约。它们可以与主字幕重叠，叠加轨内部须按时间排序且不重叠。
- 缺失稳定 ID 按 `overlay-001` 等确定性规则补齐，原有 ID 保持。颜色／表情包 `headIdx` 只引用叠加轨自身，不引用主轨。
- SRT 和启动器文本模式 ASS 导入共享两层分配规则，超过主轨＋叠加轨容量明确报错；文稿匹配的严格 SRT 读取仍拒绝任何重叠。ASS 导入仅保留时间与文本，不等于样式文档往返。
- 合并 SRT 导出按起点排序，同起点主轨在前；跳过禁用、空文本以及关闭的叠加轨，输出序号连续。空主轨也可导出启用的叠加轨。
- `multi_subtitle` 继续表示副字幕，`msw.audio_clips` 继续表示配音贴片；二者不能用作叠加轨替代结构。MSW 未知可选字段和素材引用继续保留。
- `preview.subtitle.ass_color_style` 为独立 ASS 颜色映射：`text`／`speaker`／`stroke`／`none`；`speaker` 仅着色映射生成的名称及分隔符，正文恢复有效基础色。原 CSS `color_style` 的历史 `shadow` 值仍兼容读取。

### 1.5 multi_subtitle 多重字幕

`multi_subtitle` 是可选的双语字幕扩展结构。旧工程缺失该字段时，编辑器按关闭状态加载；保存时会补写关闭的空结构。顶层 `segments` 始终是主轨真源，扩展字幕只放在 `tracks[*].segments` 中。

```json
{
  "multi_subtitle": {
    "schema": "moy.asr.multi_subtitle.v1",
    "enabled": true,
    "display_mode": "both",
    "main_split_mode": "word",
    "tracks": [{
      "id": "translation",
      "role": "extension",
      "name": "English",
      "language": "English",
      "split_mode": "word",
      "source_name": "translation.srt",
      "segments": [{
        "id": "translation-segment-001",
        "start": 1100,
        "end": 2900,
        "text": "Extended subtitle",
        "items": [{"text": "Extended subtitle", "start": 1100, "end": 2900}]
      }]
    }],
    "bindings": [{
      "id": "binding-001",
      "track_id": "translation",
      "main_segment_ids": ["main-001"],
      "extension_segment_ids": ["translation-segment-001"],
      "start_offset_ms": 100,
      "end_offset_ms": -100
    }]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `multi_subtitle.schema` | string | 否 | 固定为 `moy.asr.multi_subtitle.v1` |
| `multi_subtitle.enabled` | boolean | 否 | 默认 `false`；关闭只隐藏扩展数据，不删除数据 |
| `multi_subtitle.display_mode` | string | 否 | `main` / `extension` / `both`，默认 `both` |
| `multi_subtitle.main_split_mode` | string | 否 | 主字幕语言类型：`continuous`（字符型）或 `word`（单词型）；旧工程缺失时按主字幕文本自动判断 |
| `multi_subtitle.tracks` | array | 否 | 扩展轨数组；当前 UI 只管理第一条轨道 |
| `tracks[i].id` | string | 是 | 轨道稳定 ID |
| `tracks[i].role` | string | 否 | 当前固定为 `extension` |
| `tracks[i].name` | string | 否 | 用户可见轨道名 |
| `tracks[i].language` | string | 否 | 语言或语言代码 |
| `tracks[i].split_mode` | string | 否 | 副字幕语言类型：`continuous`（字符型）或 `word`（单词型）；用于近似拆分和字数统计 |
| `tracks[i].source_name` | string | 否 | 来源文件名，不保存绝对路径 |
| `tracks[i].segments` | array | 是 | 扩展字幕段；每段至少有段级时间码和文本，`items` 可选 |
| `tracks[i].segments[j].id` | string | 是 | 扩展字幕稳定 ID |
| `tracks[i].segments[j].start/end` | int | 是 | 非负整数毫秒，`start < end` |
| `tracks[i].segments[j].text` | string | 是 | 扩展字幕文本 |
| `tracks[i].segments[j].items` | array | 否 | 可选字词时间码；结构和主轨 `segments[i].items` 相同 |
| `tracks[i].segments[j].disabled` | bool | 否 | 禁用该扩展字幕；预览、隐藏禁用项和扩展 SRT 导出会跳过它 |
| `bindings` | array | 否 | 主轨与扩展轨的绑定关系 |
| `bindings[i].track_id` | string | 是 | 指向扩展轨 ID |
| `bindings[i].main_segment_ids` | array | 是 | MVP 必须恰好一个主轨 ID |
| `bindings[i].extension_segment_ids` | array | 是 | MVP 必须恰好一个扩展轨 ID |
| `bindings[i].start_offset_ms` | int | 是 | `extension.start - main.start` |
| `bindings[i].end_offset_ms` | int | 是 | `extension.end - main.end` |

约束：

- 主轨和扩展轨段均使用不重复的稳定字符串 ID；当前规范化会为缺失 ID 的输入补齐，并在导出/保存时写入。主轨按 `main-001`、扩展轨按 `<track-id>-segment-001` 的顺序生成；如果生成值与后续显式 ID 冲突，会使用确定性的 `-generated` 后缀。浏览器与 Python 服务端使用同一规则。
- 当前 MVP 强制每个绑定一对一；数组形式保留给未来一对多关系，但当前校验要求数组长度均为 1，且一个端点不能重复绑定。
- 自动导入按段级时间码匹配：时间区间有交集，且开始/结束时间差均不超过 `300ms`；冲突选择总差值最小的候选。未匹配段保留，可手动绑定。
- SRT 导入没有字词时间码，因此扩展段通常不带 `items`；mosp/json 导入和主副交换可以带上可选 `items`，保存、加载和再次交换时保留它们。
- `continuous`（字符型）允许字符边界，`word`（单词型）只允许空格或安全标点附近的边界，禁止拆碎单词。切分时会清理断点两侧相邻的中英文逗号、句号及空白；两种模式也分别决定字数统计规则。
- `enabled: false` 时工程仍保留轨道、绑定、语言类型和 ID；主轨 SRT 导出语义不变，扩展轨使用独立 SRT 导出。

---

## 二、segment 对象

`segments[i]` 的字段定义：

```json
{
  "id": "main-001",
  "start": 1234,
  "end": 5678,
  "start_frame": 37,
  "end_frame": 170,
  "text": "字幕文本",
  "items": [ ... ],
  "speaker": "1",
  "sticker": null,
  "sticker_ref": null,
  "color": null,
  "color_ref": null,
  "_dirty": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | **必填** | 主字幕稳定 ID；输入缺失时规范化为 `main-001`、`main-002` 等确定性 ID |
| `start` | `int` | **必填** | 段起始时间，**单位毫秒** |
| `end` | `int` | **必填** | 段结束时间，**单位毫秒**，要求 `end > start` |
| `start_frame` | `int` | 否 | 与 `end_frame` 成对出现的帧起始编号；`timebase.unit` 为 `frames` 时由编辑器使用 |
| `end_frame` | `int` | 否 | 与 `start_frame` 成对出现的帧结束编号，要求 `end_frame > start_frame` |
| `text` | `string` | **必填** | 字幕显示文本。可含 `\n` 表示换行（在编辑器里渲染为 `<br>`） |
| `items` | `array<object>` | 推荐填 | 字级时间戳数组。用于「双击拆分时按字分配时间」。可填 `[]`，此时拆分会按字符比例估算时间点 |
| `disabled` | `bool` | 否 | 禁用该字幕；预览、隐藏禁用项和默认导出会跳过它 |
| `speaker` | `string` | 否 | 说话人标签（非空字符串）。保存供应商返回的 opaque ID（如 Soniox 的 `"1"`/`"2"`），不转换为整数或姓名。仅当该段所有带语音 items 都是同一 speaker 时才写入；缺少该字段的旧工程继续有效 |
| `timing_precision` | `string` | 否 | Qwen 仅有句级真实锚点而需要细分时写 `interpolated`，表示按真实句范围估算的子句；这些子句不含伪造的词级 `items`。无真实时间锚点的纯文本不能生成字幕 |
| `sticker` | `object\|null` | 否 | 表情包 head 信息。见第四节 |
| `sticker_ref` | `object\|null` | 否 | 引用上方 head 的表情包（跨多句用） |
| `color` | `object\|null` | 否 | 颜色标记 head。见第四节 |
| `color_ref` | `object\|null` | 否 | 引用上方 head 的颜色 |
| `_dirty` | `bool` | 否 | 是否被人工改过。**生成时不要写 `true`**，仅由编辑器内部维护 |

### 关键约束

- `start` / `end` / `items[*].start` / `items[*].end` 全部是**整数毫秒**（不是秒、不是字符串、不是浮点）；它们是兼容时间字段
- `start_frame` / `end_frame` 与 `items[*].start_frame` / `items[*].end_frame` 是可选的独立帧字段，必须成对出现并为非负整数，结束帧大于起始帧
- 密集字词可以共享同一帧；编辑与保存时保留有序且位于字幕内的字词毫秒区间，并推导辅助帧编号，避免重复帧取整令保存结果持续漂移。
- 进入帧模式后，编辑器以帧字段为操作真源，同时更新毫秒投影；切换 FPS 会保留实际媒体时间并重新计算帧编号
- `segments` 建议按时间升序排列，且 `segments[i].end <= segments[i+1].start`
- 代码不强校验时间重叠，但重叠会导致播放器跳转/高亮行为异常
- `items` 首元素 `start` 建议等于 segment `start`，末元素 `end` 建议等于 segment `end`
- 带 `speaker` 的工程遇到说话人变化时**必须切分字幕**，不能把两个 speaker 合入同一 segment

---

## 三、items（字级时间戳）

`segments[i].items[k]` 的字段：

```json
{
  "text": "字",
  "start": 1234,
  "end": 1300,
  "start_frame": 37,
  "end_frame": 39,
  "speaker": "1"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | `string` | 是 | 单字或单词。**所有 item 的 `text` 拼接后应等于所属 segment 的 `text`**（标点也应包含在内，编辑器拆分时会按需剥掉） |
| `start` | `int` | 是 | 该字/词起始时间（毫秒） |
| `end` | `int` | 是 | 该字/词结束时间（毫秒） |
| `start_frame` | `int` | 否 | 独立帧起始编号，与 `end_frame` 成对出现 |
| `end_frame` | `int` | 否 | 独立帧结束编号，与 `start_frame` 成对出现 |
| `speaker` | `string` | 否 | 该字/词的说话人标签（非空字符串），保存供应商返回的 opaque ID |

### 生成建议

- 中文逐字给时间戳，英文按词给
- 标点符号可作为零宽 item（`start == end`），或并入前一个字的 item，代码都能容忍
- 若生成模型拿不到字级时间，**填 `[]` 也可接受**，编辑器会按字符比例自动插值（拆分时间精度会下降）
- 如果 `items` 字段整个缺失，编辑器视同 `[]`

---

## 四、表情包 / 颜色（head + ref 系统）

这套机制服务于「跨多句字幕覆盖同一个表情包或颜色」的需求。

**生成 JSON 时直接全部填 `null` 即可**，让用户在编辑器里手动分配。本节仅供深度二次开发参考。

### 4.1 sticker head（首条持完整信息）

```json
{
  "name": "表情包名（去扩展名）",
  "filename": "表情包名.png",
  "rel": "相对 sticker_root 的路径，通常等于 filename",
  "width": 1920,
  "height": 1080,
  "start": 1234,
  "end": 9999
}
```

| 字段 | 说明 |
|---|---|
| `name` | 显示名，通常等于文件名去扩展名 |
| `filename` | 完整文件名（含扩展名） |
| `rel` | 相对 `sticker_root` 的路径。平铺目录下等于 `filename` |
| `width` / `height` | 可选正整数，原始图片像素宽高。旧工程缺失时，导出器使用兼容默认值。 |
| `start` / `end` | 表情包时间范围（毫秒）。导出 EDL 时使用；跨多句时通常等于 head 段的 `start` 与最后一句的 `end` |

### 4.2 sticker_ref（后续条引用 head）

```json
{
  "name": "表情包名",
  "headIdx": 5
}
```

`headIdx` 是 `segments` 数组里的整数下标（0-based），指向同属一个表情包的 head 段。拆分/合并/删除时编辑器会自动维护这个索引。

### 4.3 color head

```json
{ "name": "red", "value": "#f07f6f", "start": 1234, "end": 9999 }
```

`name` 只能是以下 5 种之一（调色板唯一权威定义在 `maw/colors.py` 的 `COLOR_PALETTE`：speaker 自动取色、1~5 手动标记与编辑器/波形显示共用，构建时注入编辑器；下表为当前值，旧工程可能保留调整前存储的 `value`）：

| name | value |
|---|---|
| `yellow` | `#c4a019` |
| `green` | `#66bb6a` |
| `red` | `#f07f6f` |
| `purple` | `#bf89e6` |
| `blue` | `#61a7fa` |

### 4.4 color_ref

```json
{ "name": "red", "headIdx": 5 }
```

---

## 五、最小可用示例

下面这份 JSON 可被编辑器直接接受：

```json
{
  "media": "D:/path/to/video.mp4",
  "language": "Chinese",
  "model": "your-model-name",
  "segments": [
    {
      "start": 0,
      "end": 2150,
      "text": "大家好",
      "items": [
        { "text": "大", "start": 0, "end": 620 },
        { "text": "家", "start": 620, "end": 1280 },
        { "text": "好", "start": 1280, "end": 2150 }
      ],
      "sticker": null,
      "sticker_ref": null,
      "color": null,
      "color_ref": null
    },
    {
      "start": 2200,
      "end": 5400,
      "text": "今天给大家介绍一下字幕编辑器的 JSON 规范。",
      "items": [
        { "text": "今", "start": 2200, "end": 2350 },
        { "text": "天", "start": 2350, "end": 2510 },
        { "text": "给", "start": 2510, "end": 2680 },
        { "text": "大", "start": 2680, "end": 2850 },
        { "text": "家", "start": 2850, "end": 3020 },
        { "text": "介", "start": 3020, "end": 3200 },
        { "text": "绍", "start": 3200, "end": 3400 },
        { "text": "一", "start": 3400, "end": 3580 },
        { "text": "下", "start": 3580, "end": 3780 },
        { "text": "字", "start": 3780, "end": 3950 },
        { "text": "幕", "start": 3950, "end": 4120 },
        { "text": "编", "start": 4120, "end": 4300 },
        { "text": "辑", "start": 4300, "end": 4480 },
        { "text": "器", "start": 4480, "end": 4660 },
        { "text": "的", "start": 4660, "end": 4820 },
        { "text": "JSON", "start": 4820, "end": 5170 },
        { "text": "规", "start": 5170, "end": 5290 },
        { "text": "范", "start": 5290, "end": 5400 },
        { "text": "。", "start": 5400, "end": 5400 }
      ],
      "sticker": null,
      "sticker_ref": null,
      "color": null,
      "color_ref": null
    }
  ]
}
```

---

## 六、给 LLM 生成 JSON 的 Prompt 模板

把下面这段直接粘给任意模型当生成约束：

```
请基于我提供的字幕文本与时间信息，生成符合如下规范的 JSON：

1. 输出必须是合法 UTF-8 JSON，顶层为 object，含 segments 数组（必需）
2. 每个 segment 必须有 start、end、text 三个字段
3. `start` / `end` 及 items 时间字段统一为毫秒整数（不是秒、不是字符串、不是浮点）；如使用帧模式，再提供成对的帧字段和 `timebase`
4. start < end，且 segments 按时间升序排列
5. items 数组每项 {text, start, end}；所有 item 的 text 拼接后应等于 segment.text
6. items 首项 start = segment.start，末项 end = segment.end
7. 标点作为零宽 item（start=end）或并入前一个字
8. sticker / sticker_ref / color / color_ref 全部填 null
9. 不要输出 _dirty 字段
10. 不要输出任何 JSON 之外的解释文字、Markdown 代码块标记
11. 中文逐字给时间戳，英文按词给
12. media / language / model 字段按需填写，允许省略
13. 不要生成 waveform；它是编辑器从媒体自动计算的缓存
```

---

## 七、校验方式

生成后任选其一验证：

### 方式 1：用 edit.py 直接生成 HTML

```bash
cd <MSW 仓库目录>
uv run python edit.py your_generated.mosp
```

成功会生成 `your_generated.edit.html`。

### 方式 2：用空壳编辑器加载

1. `file://` 双击打开本仓库根目录的 `blank-editor.html`
2. 点「打开工程」选 `.mosp` 或 `.json` 工程文件
3. 若弹出「文件格式不对，缺少 segments 字段」红色提示，说明顶层结构错误
4. 若正常显示字幕列表，则格式合格

### 方式 3：JSON Schema 自检（可选）

用任意 JSON 校验工具确认以下条件：

- 顶层是 object
- `segments` 是数组，且每个元素都是 object
- 每个 segment 含 `start` / `end` / `text`
- `start` / `end` 为非负整数且 `start < end`
- `segments[*].items` 若存在，每个元素含 `text` / `start` / `end`

---

## 八、字段速查表

| 字段路径 | 类型 | 必填 | 单位/取值 |
|---|---|---|---|
| `segments` | array | ✅ | 字幕段数组 |
| `segments[i].start` | int | ✅ | 毫秒 |
| `segments[i].end` | int | ✅ | 毫秒 |
| `timebase` | object | ❌ | `{unit: milliseconds\|frames, fps: 1–240}` |
| `segments[i].start_frame` | int | ❌ | 帧编号，与 `end_frame` 成对 |
| `segments[i].end_frame` | int | ❌ | 帧编号，与 `start_frame` 成对 |
| `segments[i].text` | string | ✅ | 显示文本 |
| `segments[i].items` | array | 推荐 | 字级时间戳，可 `[]` |
| `segments[i].disabled` | bool | ❌ | 禁用该字幕 |
| `segments[i].items[k].text` | string | ✅ | 单字/词 |
| `segments[i].items[k].start` | int | ✅ | 毫秒 |
| `segments[i].items[k].end` | int | ✅ | 毫秒 |
| `segments[i].items[k].start_frame` | int | ❌ | 帧编号，与 `end_frame` 成对 |
| `segments[i].items[k].end_frame` | int | ❌ | 帧编号，与 `start_frame` 成对 |
| `segments[i].items[k].speaker` | string | ❌ | 说话人 opaque ID |
| `segments[i].speaker` | string | ❌ | 段内统一说话人才写入 |
| `segments[i].sticker` | object\|null | ❌ | 表情包 head |
| `segments[i].sticker_ref` | object\|null | ❌ | `{name, headIdx}` |
| `segments[i].color` | object\|null | ❌ | `{name, value, start, end}` |
| `segments[i].color_ref` | object\|null | ❌ | `{name, headIdx}` |
| `segments[i]._dirty` | bool | ❌ | 生成时不要写 |
| `media` | string | ❌ | 媒体文件路径 |
| `language` | string | ❌ | 语言代码 |
| `model` | string | ❌ | 模型名 |
| `sticker_root` | string | ❌ | 表情包根目录 |
| `waveform` | object | ❌ | 可丢弃的 `moy.asr.waveform.v1` 峰值缓存 |
| `gap_remove` | object | ❌ | 可逆的 `moy.asr.gap_remove.v1` 空隙移除决定 |
| `multi_subtitle` | object | ❌ | 可选的 `moy.asr.multi_subtitle.v1` 主轨/扩展轨与绑定 |
| `preview` | object | ❌ | 预览呈现设置容器 |
| `preview.burn_subtitles` | object | ❌ | 视频烧录与实际渲染预览共用样式；可含 `main`、`secondary`，各轨缺省字段使用默认样式 |
| `preview.subtitle.x` | number | ❌ | 归一化 `[0,1]`，`x + width <= 1` |
| `preview.subtitle.y` | number | ❌ | 归一化 `[0,1]`，`y + height <= 1` |
| `preview.subtitle.width` | number | ❌ | 归一化 `[0,1]`，编辑器最小 0.20 |
| `preview.subtitle.height` | number | ❌ | 归一化 `[0,1]`，编辑器最小 0.08 |
| `preview.subtitle.font_size` | number | ❌ | px，范围 `[12,96]`；缺失时使用响应式默认字号 |
| `preview.subtitle.font_family` | string | ❌ | 内置字体键，或本机字体族名称；缺少该字体时预览回退到默认无衬线字体 |
| `preview.subtitle.background_color` | string | ❌ | 6 位十六进制颜色 `#RRGGBB`；缺失时使用黑色 |
| `preview.subtitle.background_alpha` | number | ❌ | 不透明度 `[0,1]`；缺失时使用 `0.65`，设为 `0` 时隐藏字幕背景 |
| `preview.subtitle.color` | string | ❌ | `#RRGGBB` 六位十六进制颜色，默认 `#ffffff` |
| `preview.extension_subtitle` | object | ❌ | 拓展字幕样式；沿用主字幕预览框 |
| `preview.extension_subtitle.font_size` | number | ❌ | px，范围 `[12,96]`；缺失时默认比主字幕小 2px |
| `preview.extension_subtitle.font_family` | string | ❌ | `default` / `yahei` / `hei` / `song` / `sans` |
| `preview.extension_subtitle.color` | string | ❌ | `#RRGGBB` 六位十六进制颜色，默认 `#ffd34d` |
| `preview.sticker.x` | number | ❌ | 归一化 `[0,1]`，`x + width <= 1` |
| `preview.sticker.y` | number | ❌ | 归一化 `[0,1]`，`y + height <= 1` |
| `preview.sticker.width` | number | ❌ | 归一化 `[0,1]`，编辑器最小 0.20 |
| `preview.sticker.height` | number | ❌ | 归一化 `[0,1]`，编辑器最小 0.08 |
---

## 九、版本与兼容

- 本规范与 `edit.py` / `generate_subtitle_qwen_api.py` 当前实现同步
- 设计决策（字级时间戳为何重要、长音频切片策略等）见 `CHANGELOG.md`
- 字段命名保持向后兼容：新增字段不会破坏旧 JSON 加载
- 旧编辑器会忽略新增的 `waveform` 字段；新编辑器可加载完全不含该字段的旧工程
- 删除字段会触发兼容性记录到 `CHANGELOG.md`

## 十、MSW 编辑器扩展（可选）

顶层 `msw` 保存独立编辑器的工程身份与处理结果应用记录。旧工程可以不含此字段；当前编辑器加载后补充身份，随下次工程保存写入。它不改变主字幕、`multi_subtitle` 或整数毫秒的时间规则。

```json
{
  "msw": {
    "schema": "msw.editor.v1",
    "project_id": "project-example",
    "applied_results": ["completed-job-id"],
    "translation_applications": {"partially-applied-job-id": ["main-segment-id"]}
  }
}
```

| 字段 | 契约 |
| --- | --- |
| `schema` | 必须为 `msw.editor.v1`；未知版本拒绝加载，避免静默丢失数据 |
| `project_id` | 工程稳定标识，1–128 位 ASCII 字母、数字、`_ . : -`；普通保存与恢复保留身份，另存为和新建工程生成新身份 |
| `applied_results` | 可选，完全应用过的任务 ID 数组，最多 10000 项；用于避免重复应用 |
| `translation_applications` | 可选，对部分应用的任务记录已经写入的主字幕 ID；对象及每个数组最多 10000 项。任务 ID 遵循上述 ASCII 规则；字幕 ID 沿用原工程的不透明字符串规范（规范化后最多 160 字符，可含中文） |
| `processing_results` | 可选，最多 10000 个候选批次。每条含 ASCII `id`、`kind`（`asr`／`translation`）、正整数 `number`、`edits` 和 `applications`。同工程同类型编号递增，不随排序变化 |
| `translation_target_tracks` | 可选，部分应用时新建的副轨 ID，按任务 ID 索引，最多 10000 项；轨道 ID 沿用原工程的 160 字符规则。继续应用剩余结果时复用同一轨，完成后清除 |
| `assets` | 可选，不可变音频素材数组，最多 10000 项；字段见下表。字幕历史保留该素材库存，不随字幕撤销删除 |
| `subtitle_assets` | 可选，独立字幕素材数组，最多 10000 项；每条一个卡片，不参与混音或原字幕播放。复制、编辑、删除随字幕历史撤销/重做 |
| `asset_batches` | 可选，最多 10000 个批次；每条字幕素材必须引用存在的批次。旧音频按 `batch_id` 或 `job_id` 推导批次，不要求迁移旧工程 |
| `removed_asset_ids` | 可选，已从当前工程移除的素材 ID 数组，最多 100000 项，不接受 null、重复项或与 `assets` 同时存在的 ID；ID 为 `audio-` 加 32 位小写十六进制。保存／恢复后过滤后台重复结果。删除素材及其贴片是独立可撤销操作，字幕撤销保留当前删除决定；磁盘字节保留，不因移除引用立即删除 |
| `source_project_id` | 可选，另存为时记录直接来源工程 ID，格式与 `project_id` 相同。副本使用新 `project_id`，素材 ID 保留；字幕撤销不会回滚当前工程身份 |
| `audio_tracks` / `audio_clips` | 可选，配音轨及源时间轴上的独立贴片；不存在等同空数组，出现时不能为 null。详见 C 阶段契约 |
| `audio_settings` | 可选，工程级的热力图和空隙策略；不存在使用默认值，出现时不能为 null |

`msw` 内未识别的字段按 JSON 原样保留，经历加载、保存、另存为及字幕撤销/重做时不能被白名单裁掉。结果应用记录与副字幕变动进入同一条撤销记录；撤销翻译会同步撤销其应用记录。另存为沿用既有任务隔离规则：生成新 `project_id`、记录 `source_project_id`，清空 `applied_results` 并移除 `translation_applications`／`translation_target_tracks`；字幕、配音轨／贴片、素材 ID 和删除记录继续保留。旧版本编辑器不一定保留这个扩展，不能用旧版本往返保存承诺兼容。

任务状态、输入快照和译文存入本机应用数据目录的 `editor-jobs/port-<端口>.sqlite3`，不嵌入工程文件。工程中不写 API Key 或连接配置。旧工程首次以服务器打开时，未保存身份前按工程路径派生 ID；浏览器导入的旧工程则生成新 ID，因此想在重新打开后找回任务应先保存工程。

当前翻译仅写入现有唯一副字幕轨；新建块采用当前主字幕位置，已有目标保持当前起止时间，绑定偏移随实际时间更新。修改译文后清除目标原有字词时间码，因为旧时间码已不能描述新文本。

### TTS 音频素材（B 阶段）

独立文本配音是 v1 的可选扩展：`source_ref.kind = "editor_text"`，`id` 为独立草稿来源标识（不引用字幕），`track_id = null`，`text` 是提交时的正文，`start` 是提交时播放头的整数毫秒，`end` 为 start 加实际音频时长（向上取整到毫秒）。任务快照允许同一批多条此类来源，每段使用独立 key／id；其中临时 end=start+1 在入库时被实际时长替换，快照本身不变。省略 kind 的旧记录及显式 kind="subtitle" 继续按既有来源规则读取；未知 kind 拒绝。草稿可用于三种引擎，生成素材沿用同一保存／收集／导出结构；未提交草稿仅在页面内暂存，不进入浏览器持久存储或工程。

音频字节存入工程旁的素材目录，本机尚未保存的结果暂存于应用数据目录。工程不保存临时下载 URL，也不保存 API Key。来源字幕后续修改不改变已有音频。

| 素材字段 | 契约 |
| --- | --- |
| `id` / `kind` | `audio-` 加 32 位小写十六进制 UUID；`kind` 固定 `audio` |
| `path` | 相对工程目录：`msw-<24 位小写十六进制身份摘要>.assets/audio/<id>.wav`。拒绝绝对路径、反斜线和目录穿越 |
| `sha256` / `byte_size` | WAV 文件 SHA-256（64 位小写十六进制），字节数 44–33554432 |
| `sample_rate` / `channels` / `sample_count` | 实测整数，采样率 8000–192000，通道 1–8，样本帧数 1–2^32。时长由 `sample_count / sample_rate` 得到 |
| `job_id` / `created_at` | 生成任务 ID；生成时间为 Unix 秒 |
| `generation` | 不含密钥的生成配置：`provider`、`region`、`model`、`voice`、`language_type`、`instructions`、`optimize_instructions`、`display_text`、`spoken_text`；百炼新增可选 `model_type`（`CustomVoice`／`VoiceDesign`／`VoiceClone`）。旧素材可缺少模式；模型稳定别名按实际请求名记录，不伪造解析后的快照版本，不保证云端音色永久有效 |
| `source_ref` | `key` 为任务条目 ID；字幕来源的 `id` 为字幕稳定 ID；`track_id` 为副轨 ID，主轨为 null；主字幕转入叠加轨时保留 null 并增加 `track_kind: "overlay"`，返回主轨时移除此标记，稳定 ID 与音频文件不变；`text`、`start`、`end` 为提交时快照，时间单位整数毫秒。独立文本来源见上文 |

任务输入单独保存，逐条结果单独登记，更新进度时不反复重写整份字幕快照。字幕的 `msw` 结果应用记录仍随历史往返；`assets` 属于独立素材库存，字幕撤销／重做保留该库存。

### 字幕素材与批次

`subtitle_assets[*]` 必填 `id`、`kind: "subtitle"`、`batch_id`、`source_id`、`source_cue_id`、`track_id`、`created_at`、`original_start`、`start`、`end`、`text`。前三个 ID 与来源 ID 使用 MSW 稳定标识规则；`source_cue_id` 为原字幕 ID（1–160 字符），`track_id` 为 null（主字幕）或原副轨 ID（1–160 字符）。

`created_at` 为 Unix 毫秒；`original_start` 是原时间线起点，`start/end` 是相对批次最早起点的毫秒时间。时间均为非负 JavaScript 安全整数，`end > start`。文本最多 12000 个 Unicode 字符。`items` 如存在，最多 12000 项，必须位于该素材起止范围内，使用同一批次相对时间；修改素材文字时移除原逐字时间，避免伪造文字对齐。可选 `color: {name, value}`，颜色 value 为六位十六进制；复制时把颜色引用解析为独立颜色，插入不引用原字幕下标。`style`、`split_mode` 如存在则保留。

`asset_batches[*]` 必填 `id`、`kind`、`created_at`。kind 支持 `copy/asr/tts/imported/regenerated`；可选 `parent_id`、`result_id` 记录来源和入库去重；`result_ids` 为至多 10000 个不重复合法任务 ID，记录同批已入库 ASR 子任务，支持部分完成后追加。`regenerated` 批次的 `parent_id` 指向原音频素材 ID。`bindings` 可选，保留完整选中配对的 `track_id`、主副字幕原 ID 数组与整数时间偏移；只有配对双方都被成功放入时才创建新绑定。批次和素材 ID 不重复，字幕素材必须有对应批次。

音频可选 `batch_id`（合法 MSW ID），用于将同次多文件导入归组；缺省回退到原 `job_id`。字幕素材字段随工程内容及恢复快照保存，另存为保留其 ID、来源和时间关系。音频素材字节与原配方管理不变。

工作区布局树的模块 ID 新增 `assets`，可进入已有 `module`、`tabs` 和 `split` 结构。旧布局缺少该模块时默认为隐藏；不会为了补足五个模块重排用户布局。

百炼音色设计／复刻的本机音色库与创建任务另存应用数据目录 `qwen-voices/voices.sqlite3`，试听预览存 `qwen-voices/previews/`，不作为工程素材自动导出。工程仅记录合成时使用的模式、精确请求模型与音色 ID；API Key、密钥配置摘要、参考音频、音色创建输入不写入工程。音色创建与逐字幕 TTS 是独立操作，不由字幕合成隐式触发。

外部导入音频沿用相同的不可变素材结构，`generation.provider = "imported"`、`model = "external-audio"`、`voice = ""`、`language_type = "Auto"`；另存原始 `filename`、上传内容的 `source_sha256` 和 `text_origin = "filename"`。`display_text` 与 `source_ref.text` 为去扩展名的文件名，`spoken_text = ""`，不伪造识别文本。`job_id`、来源 `key/id` 为 `import-<请求标识>`，`track_id = null`，`start = 0`、`end` 为素材实际时长换算的整数毫秒。这些来源标识不代表已有字幕绑定。标准 PCM WAV 保留原采样参数；其他支持格式转换为 48 kHz、双声道、16-bit WAV。素材 `sha256` 始终描述最终 WAV，与原文件摘要区分。

油库里使用 `generation.provider = "yukkuri"`、`model = "aquestalk1"`，音色为 `f1/f2/m1/m2/dvd/imd1/jgr/r1`，另记 `speed`（50–300 的整数）、`engine_version`、`resource_version`、`text_version`。`language_type` 为 `Auto/Chinese/English`。`display_text` 保留原文，`spoken_text` 是实际传给引擎的假名，允许最长 12000 字符；其他必需配方字符串仍最多 2000 字符。可选 `source_ref.pronunciation_override` 为最长 600 字符的单条读音修正，批量快照中逐条独立保存；来源 `text` 不被替换。素材为普通 8 kHz、16-bit、单声道 WAV。以上为 v1 的兼容扩展，不改变时间或采样单位。引擎路径与当前 TTS 引擎偏好仅保存本机，不进入工程。

IndexTTS 使用 `generation.provider = "indextts"`、`model = "index-tts-2.5"`，`voice` 为音色参考名称，`language_type` 为 `ZH/EN/JA/AR/ES`。配方包含 `speaker_ref`、`emotion_ref`（`ref-<WAV SHA256>` 或未使用时为空）、对应可用的 `_name`／`_sha256`，以及 `emotion_mode`（`follow/audio/vector/text`）、`emotion_weight`、八项 `emotion_vector`、`emotion_text`、`emotion_random`、`duration_factor`、`max_text_tokens_per_segment`、`do_sample`、`top_p`、`top_k`、`temperature`、`length_penalty`、`num_beams`、`repetition_penalty`、`max_mel_tokens`。`source_ref.pronunciation_override` 可覆盖单条配音输入，`display_text` 保留字幕，`spoken_text` 保存实际输入。参考字节和服务地址只在本机 `index-tts/` 下保存，不嵌入工程；生成 WAV 继续自动收集。全局引擎偏好迁入本机 `tts-engine.json`，兼容读取旧油库里设置。 本机服务启动配置另存应用数据目录 `tts-services/`（安装目录、自动检测的 Python、端口、启动等待上限与 QwenEmotion 开关），不进入工程／素材配方。A+B 不新增 generation 版本，也不改变已有三引擎每段 600 Unicode 字符的兼容限制；未知引擎禁止合成，不回退到百炼。以上为 v1 兼容扩展，采样与时间单位不变，详见 [IndexTTS 配音](docs/EDITOR_INDEXTTS.md)。

GPT-SoVITS 使用 `generation.provider = "gpt-sovits"`、`model = "api-v2"`；`language_type` 为实际输出语言，`voice` 为参考名称。`gpt_model`／`sovits_model` 是本机登记的 `model-<64 hex>` 标识（相对名称、文件头和 stat 指纹），`speaker_ref`／`aux_refs` 为 `ref-<WAV SHA256>`。配方保存 `prompt_text`、独立的 `prompt_lang`、`no_prompt`、`speed_factor`、`text_split_method`、`top_k`、`top_p`、`temperature`、`seed`、`repetition_penalty`、`sample_steps`、`super_sampling`。本机路径、服务地址、Python 路径与参考字节不进入工程；重生成必须能在本机解析同一模型与参考，不自动替换缺失资源。

Edge 使用 `generation.provider = "edge"`、`model = "edge-online"`，`voice` 为完整 ShortName，`language_type` 由音色派生。`rate`（−50～100）、`volume`（−100～100）为整数百分比变化，`pitch`（−100～100）为整数 Hz 变化，默认均为 0。缓存音色和网络等待配置只保存到本机。两引擎均沿用现有 WAV／素材与 source_ref 契约、每段 600 字符限制，不提升工程 schema 版本；`display_text`／`spoken_text` 保存实际提交文本。


另存为自动收集 TTS 音频；可选原媒体写入新工程旁 `msw-<新身份摘要>.assets/media/<内容摘要><扩展名>`，顶层 `media` 保存相对路径。未收集的原媒体继续使用原引用（搬出原目录时已知相对引用转换为绝对引用）。缺失音频不删除元数据或贴片，保存响应单独报告缺失清单。

恢复草稿和按分钟采样的保存历史写入本机 `editor-recovery.sqlite3`，不属于工程契约，不随工程搬移；快照不保存可重建波形或音频字节。读取历史快照时同样验证两个工程版本，旧快照只在返回的内存副本补顶层版本，不改写数据库原记录；未知版本在登记恢复来源前拒绝。详见[保存与恢复](docs/EDITOR_PERSISTENCE.md)。

### 音频贴片（C 阶段）

贴片与字幕块独立；移动、裁剪和静音只修改贴片，不改素材音频或字幕。多个贴片可以引用同一素材，并在同一配音轨内重叠混合。界面子行由时间重叠计算，不另存行号。

`audio_tracks` 最多 32 项，每项包含唯一 `id`（沿用工程 ASCII ID 规则）、`name`（最多 160 字符）、`gain_db`（有限数值 −60 至 +12）和 `muted`（布尔）。当前界面自动建立一个配音轨，保留多轨的工程契约。

`audio_clips` 最多 10000 项，单条示例（引用的素材及轨道须同时存在）：

```json
{
  "id": "clip-example",
  "track_id": "voice-1",
  "asset_id": "audio-0123456789abcdef0123456789abcdef",
  "start_ms": 2500,
  "source_in_sample": 12000,
  "source_out_sample": 48000,
  "playback_rate": 1,
  "gain_db": 0,
  "muted": false,
  "label": "这是配音文字"
}
```

| 字段 | 契约 |
| --- | --- |
| `id` | 工程内唯一，沿用 ASCII ID 规则 |
| `track_id` / `asset_id` | 引用现存配音轨和素材；文件缺失不删除引用，但悬空 ID 拒绝加载 |
| `start_ms` | 源媒体时间轴的整数毫秒，0–10^12，不受字幕后续移动或空隙移除改变 |
| `source_in_sample` / `source_out_sample` | 素材原始采样率下的整数**样本帧**，左闭右开；0 ≤ 入点 < 出点 ≤ 素材 `sample_count`，不乘声道数 |
| `playback_rate` | C 阶段仅接受数字 1；不支持的变速值拒绝加载 |
| `gain_db` / `muted` | 有限数值 −60 至 +12 dB／布尔。试听叠加贴片和轨道增益，任一静音则不播放 |
| `label` | 最多 2000 字符；初始为素材显示文本，不随字幕修改变化 |

贴片终点由 `start_ms + (source_out_sample − source_in_sample) × 1000 / sample_rate` 得到，可以有亚毫秒小数，不另存冗余终点。左边缘裁剪同时移动整数毫秒起点，采样范围保留整数帧；整数毫秒取整误差小于 1ms。

编辑器容量限制：同一时间最多三层贴片（包含静音贴片，首尾相接不计重叠），不是工程总贴片数最多三条。编辑及工程导入在修改当前数据前检查容量，超限整体拒绝，不截断数组或删减素材。这是编辑器交互约束，不改变 `msw.editor.v1` 文件结构或后端导出格式。

`audio_settings.heatmap` 为布尔，默认 true；`audio_settings.gap_policy` 为 `protect`（默认）或 `follow`。`protect` 从实际跳过区间中减去未静音贴片覆盖范围（终点向上取整到毫秒）；`follow` 使用原空隙决定。保护不改写 `gap_remove.gaps`，删除／静音贴片后原有决定重新生效。编辑器的有效跳过区间与 D1 / D2 音频导出共用此保护。

`preview.burn_subtitles.main/secondary` 的样式字段：`font_family`（1–128 字符，禁止控制字符、逗号及 ASS 控制符）、`font_size`（8–200，以 1080 高画面为基准）、`color`／`outline_color`／`background_color`（`#RRGGBB`）、`outline`（0–12）、`background_alpha`（0–1）、`x`／`y`（文字框底部中心，0–1）、`width`（0.1–1）。主副默认字号 48／40，垂直位置 0.86／0.94，Arial 白字、黑色描边 2、透明背景、水平居中、宽度 0.8。样式随工程保存，不修改播放器原有 `preview.subtitle`。

音频／视频导出请求可含 `options.monitor` 快照：`mode=none|source|voice|both`、`volume`（播放器线性音量 0–1）、`muted`（布尔）、`source_gain_db`（−60 至 +12）。选定声部使用监听总音量；源声部另加源试听增益。贴片／轨道原有增益始终保留。同步声部替代该侧手动导出增益，不重复叠加。零音量或静音通过渲染计划 `source.muted`／`pieces[*].muted` 精确静音；快照只属于导出任务，不作为工程字段保存。

轨道、贴片和这两项设置进入工程保存、备份与撤销／重做。音频字节继续独立存放，热力图和解码缓冲仅为可重建缓存，不写入工程。热力图采用约 400ms 窗口／100ms 步长的 RMS dBFS、固定 −60 至 −6 dBFS 色标，计入贴片和轨道增益；不是 LUFS 测量，也不是最终混音电平。

### D1 / D2 派生渲染计划

`msw.audio-render.v1` 是导出快照编译出的派生计划，不写入 `.mosp`，也不改变 `msw.editor.v1`。包括输出 `sample_rate`／`channels`／`sample_count`、源范围、保留区间到输出时间的映射、每段贴片的素材 ID／源采样入出点／输出采样起止点／叠加增益、所选原声音轨及峰值保护。取样位置使用非负数四舍五入（半值向上），区间为左闭右开。

快照中的 `gap_remove.gaps` 是编辑器 `buildJson()` 已投影的当前空隙决定；后台验证这些区间，再独立应用贴片保护和时间映射，不接受客户端提交的 FFmpeg 图或任意素材路径。共同计划夹具位于 `tests/fixtures/msw_audio_render.json`。导出格式、范围和总音量记录于本机导出任务，不成为工程设置；WAV 成品不自动添加到 TTS 素材库。

### 视频导出范围对齐

视频导出请求 `options.video_tail` 默认为 `truncate`（对齐至视频），另支持 `freeze`（对齐至音频，末帧延长）与 `black`（对齐至音频，黑屏填充）。旧 API 的 `ask` 仅保留兼容，新界面不提供。音频对齐以所选原声音轨与未静音配音末尾为准，`mode=voice` 不计原声；音频短于画面时裁切画面，空音频范围报错。监听音量、字幕末尾不参与音频长度计算。`start_ms/end_ms` 仍限定源范围，空隙移除在对齐后按共享计划执行。

视频上下文增加 `video_alignment_version: 2`，`audio_tracks[*].duration_ms` 为音轨在源时间线上的结束位置（包含起点偏移）；以流时长或容器的音轨时长标签探测，缺少时长信息时回退到媒体总时长。前后端使用同一范围规则，后台重新探测实际媒体，不信任前端时长。此配置仅属于导出任务，不写入工程。

### 编辑器 ASR 应用与派生内容复核

ASR 任务快照支持 `mode: whole/range/clips`，可选 `batch_id` 将同次操作的子任务归组。`clips` 的 `source.kind` 为 `clip`，`source.id/revision` 为音频素材 ID/SHA-256，`source.clip` 记录贴片 `id/asset_id/start_ms/source_in_sample/source_out_sample/playback_rate`（当前仅 1）；`source.duration_ms` 为完整素材样本时长向上取整，`range` 为裁剪后音频在时间线上的整数毫秒范围。后端仅按合法素材引用读取，以样本点裁剪，再将识别相对时间加上 `range.start`。增益／静音不属于识别内容版本。`batch_overlap` 标记同次选择的贴片范围重叠，阻止直接覆盖；该标记保留到重试。`targets` 保存当时受影响的主字幕，用于应用前比较；整个视频模式也只取视频时段内字幕。

ASR 素材的 `original_start` 保留映射后的时间线位置，`start/end/items` 相对于当前批次最早结果；后续更早的子任务入库会统一重基。不同贴片引用同一工程时间线，因此可以在该批次内保留相对间隔。

`msw.asr_applications` 为可选对象，最多保留 1000 个任务 ID 对应的应用记录。每条记录包含 `source_id`、64 位小写十六进制 `source_revision`、`audio_index`（0–255）、`range.start/end`（整数源毫秒，0 ≤ start < end ≤ 604800000）、`provider`、`model`（最长 256 字符）和 `removed_count/added_count`（0–10000）。已应用任务 ID 同时加入原有 `msw.applied_results`，避免重复插入。记录不包含密钥、请求头或临时音频路径。

### 可编辑处理候选（2026-09 C+D）

新 ASR／翻译面板使用 `msw.processing_results`；上述 `applied_results`、`asr_applications` 和 `translation_applications` 仍兼容旧记录，不再把新任务整体锁为“已应用”。服务原始结果与输入快照留在本机任务数据库，工程只保存修订覆盖层和应用基线，不保存服务密钥。

- `edits`：最多 10000 项，每项 `{job_id, index, text}`。`index` 是该任务原始结果的稳定行序号（0–9999），`text` 最多 12000 个字符；允许暂存空文本，但禁止将空候选直接应用或入库。ASR 文本发生变化时不再使用原词级时间码。
- `edited_at`：可选非负整数毫秒时间戳。浏览器候选暂存仅在比工程记录更新时恢复，避免旧缓存覆盖已保存的新修订。
- `applications`：可包含 `main`、`secondary`、`library` 三个目标。每项含 `revision`（按任务 ID 排序后的候选文本序列签名，最长 4000000 字符）及可选 `state`。ASR 的 `state` 保留目标轨 ID 和所影响字幕快照；翻译保存应用后的源字幕与副字幕／绑定快照。与时间线修改一起进入撤销事务。
- 整个候选记录序列的紧凑 JSON 限制为 16000000 字符。首次加载旧任务时按创建时间登记编号；后续不重排已登记编号。本机浏览器另保存无应用状态的候选暂存，用于未保存工程的刷新恢复。
- ASR 输入快照新增可选 `secondary: {track_id, targets}`，时间继续使用整数毫秒。识别范围允许切穿已有字幕；应用时才要求选整条替换或截断保留。旧任务缺副轨快照时拒绝直接覆盖副轨，可存入素材库或重新识别。
- 截断保留片段缺少可靠词时间码时，字幕条目保存 `review_required: true`，保留原文、移除无效字词映射。列表显示“待校对”，检查后点击可清除标记；清除支持撤销。可靠拆分按现有词级毫秒时间进行。
- 素材批次 `kind` 新增 `translation`，可选 `parent_id` 指向处理批次。入库使用候选修订文字；同一修订重复入库不复制。用户再次编辑后入库创建新的素材批次，保留此前素材。

`msw.asr_stale_subtitles` 是可选的 `{副轨ID: {字幕ID: ASR任务ID}}` 对象（最多 1000 个轨记录，每轨最多 10000 个字幕记录），表示原主字幕已被重新识别，保留的副字幕需要复核。失效主副绑定被解除，副字幕原文和时间保持；后续重新翻译成功覆盖该副字幕时清除相应标记。历史标记不要求当前仍存在对应字幕。音频素材和贴片保持原数据，界面依据 `source_ref` 与当前字幕／复核标记计算提示；该提示不改变播放或导出。整次应用及上述记录属于一次撤销事务。没有候选字幕时不删除旧字幕。

### D3 / D4 媒体与剪辑工程派生输出

视频和 OTIOZ 复用 `msw.audio-render.v1`，不升级 `.mosp` 或 `msw.editor.v1`。导出任务的 `options.format` 为 `wav`（兼容默认值）、`mp4` 或 `otioz`；`video_encoding` 为 `auto`（默认）/ `hardware` / `h264`（软件 CPU，兼容旧值）；`hardware_encoder` 为 `auto`（默认）/ `h264_nvenc` / `h264_qsv` / `h264_amf`，只在明确硬件模式选择对应编码器。`video_tail` 为 `ask`（旧客户端兼容）/ `truncate`（默认）/ `freeze` / `black`，`collect_media` 为布尔。上述值仅保存在本机任务与包的导出记录中，不写入工程或试听设置。

视频上下文返回 `video_encoding_version: 1` 与 `video_encoders`（`id`、`label`、`available`、`reason`），可用性须通过真实短编码，不以 FFmpeg 编码器列表为准。任务的 `video_encoder`、`encoder_label`、`encoding_note` 记录实际编码器及回退原因；成功 `result` 中同样保留，`video_encoding` 仍为 `copy` / `h264`。`encoding_eta_seconds` 为当前编码阶段剩余秒数或 `null`，基于 `.55` 至 `.92` 的真实帧进度；`progress_at` 为该进度的 Unix 秒时间戳。准备、样本不足、重试起始与合并阶段不提供数值，不表示整个任务剩余时间。

`options.burn_subtitles` 为 `none`（默认）／`main`／`secondary`／`both`，仅影响 MP4 画面，启用时强制重新编码。使用快照中的启用字幕，与音频计划共享范围及空隙映射；主副字幕分别按 `preview.burn_subtitles` 渲染独立 ASS 样式。不会修改字幕或音频贴片。素材库密度为浏览器偏好，同样不写入工程。

OTIOZ 的 `content.otio` 为 `Timeline.1` / `Stack.1` / `Track.1` / `Clip.2` 结构，配音按输出采样率表示时间，视频保留有理帧率对应时间。重叠片段分轨，增益与统一峰值衰减写入浮点 WAV；静音片段同时禁用并提供静音副本，原始 TTS 另行收集。`msw-export.json` 使用 `msw.otio-bundle.v1`，记录 `options`、`plan`、`assets`、`audio_clips`、`attenuation_db`，用途是追溯和重新链接，不是可替代 `.mosp` 的保存文件。具体引用与交付边界见 [视频与剪辑工程导出](docs/EDITOR_VIDEO_TIMELINE_EXPORT.md)。

### beta.3：说话人、轨道颜色与磁盘版本

说话人显示设置位于主预览的 `speaker_labels`，两条预览文字共用映射。缺省名称为 SP1～SP5。姓名仅用于显示及显式启用的 SRT 导出；不替换原始 `speaker`、正文、语音名称或音频素材引用。SRT 前缀和文件名选项属于编辑器偏好，不写入此映射对象。

副轨也可保存 `color` / `color_ref`；引用的 `headIdx` 必须位于同一轨 segments 内。主副轨交换整体保留稳定 ID、绑定与各段扩展字段，再按绑定映射统一的源颜色；冲突保留目标颜色。说话人来源 ID、MSW 合成记录与不可变素材元数据仍保留原值。

受控版本文件以 `.mosp-bak` 结尾，结构仍为普通 MOSP，并去掉可重建内嵌缓存。相对媒体/表情包目录引用以备份文件所在目录为基准；TTS 音频按原 `msw.assets[*].path` 收集到备份目录，多个版本共用不可变文件。版本文件不包含原视频，也不替代完整素材备份；移动时保留工程目录的相对结构。恢复接口返回带新 project_id 的待另存副本，原 project_id 保存在 source_project_id。

重新生成贴片时，可选 `source_ref.spoken_text`（1–12000 字符）记录需要原样重放的已保存读音；油库里绕过文本到假名的再次转换，IndexTTS 仍限制其输入为 600 字符。显示文字仍来自 `text`。任务快照的正文和重放读音总计最多 1000000 字符。重新生成从素材白名单配方读取调用参数，凭据／服务地址／本地资源位置使用当前环境配置；外部音频不伪造 TTS 配方。

### beta.6 说话人导出兼容

新建空工程显式设置 `preview.subtitle.speaker_labels.enabled: true`，映射仍默认关闭。缺字段的旧工程保持预览关闭；显式 true/false 原样读取。名称导出偏好保留用户明确关闭的值，`exportSpeakerLabelsExplicit` 只保存于本机编辑器偏好。

显式启用 `ass_library_exports` 时，导出请求快照另携带 `preview.burn_speaker_labels`（`enabled`、五色 `names`、`separator`，沿用名称长度及字符校验）与 `burn_ass_library`。后台只读取快照，普通保存剥离这两个临时字段。未启用新方案的工程继续原压制样式。主／叠加支持名称局部着色，副字幕保留自己的基础色；所有前缀均不改写字幕正文。


### TTS E–G：MiniMax 与 Mossland 配方

继续使用 `msw.editor.v1` 的音频素材 `generation`，不升级工程 schema。`provider` 新增 `minimax`、`mossland`，共同保存 `model`、`voice`、`language_type`、`display_text`、`spoken_text`。模型必须为当前适配器支持的 ID，音色 ID 最长 255 字符，允许供应商 ID 中的空格与括号。

- MiniMax 另存 `region`（`cn`／`global`）、`speed`（0.5–2）、`volume`（0.01–10，倍率）、`pitch`（−12～12 整数半音）、`emotion`（空串为自动；其他值按模型校验）。`language_type` 使用供应商英文语言名，自动为 `auto`。单字幕朗读修正与重新生成的已冻结读音沿用已有快照字段。
- Mossland 存单人音色 ID 和模型／快照 ID；Flash 可指定语言，Pro 为 `auto`。可选 `expected_duration_sec` 为 0.1–600 秒的期望时长，省略时由模型决定；这是生成引导，不是裁切上限，素材及贴片重新生成沿用该值。设置和任务配方可带布尔 `follow_subtitle_duration`，仅用于字幕批次提交时按整数毫秒起止差转换为秒；草稿或超出 0.1–600 秒拒绝提交。每条素材配方移除此策略字段，仅保存计算后的 `expected_duration_sec`，重生成不跟随后续字幕修改。不伪造字词时间码、音高或合成音量字段。
- 连接地址由受控地域决定；API Key、超时、参考上传数据、创建请求记录和账号音色缓存均留在本机，不进入工程。完整结果转换成现有素材 WAV；不保存临时下载 URL。
- 重新生成使用上述白名单参数，显示文本与实际朗读分开；现有七引擎旧配方及已保存的低频 Index／GPT 参数继续保留。播放增益与导出增益不写回供应商合成倍率。


## 统一多层字幕 v2

MSWE 默认在内存中迁移无版本／v1 工程，并以 `msw.project.v2` 保存。打开本身不改写原文件；保存、另存为、自动保存、恢复草稿、便携 HTML 及处理结果应用使用同一版本与身份规则。Launcher 生成的旧格式仍可打开；尚未适配多层的预制 ASR／后处理拒绝 v2 输入，避免抹平重叠。上文未注明版本的旧字段继续保留。

### 身份与时间

- 顶层版本定为 `msw.project.v2`；`msw.schema`、`multi_subtitle.schema` 不随之升级。
- 主字幕继续使用 `segments`，副字幕继续使用 `multi_subtitle.tracks[*].segments`。不复制正文到另一个“层”数组。
- 唯一定位为 `{role: "main" | "extension", track_id: null | string, cue_id: string}`。不同角色可使用同一个 ID，同一角色／副轨内不得重号。
- `start`／`end` 是整数毫秒，`0 <= start < end`，半开区间 `[start,end)`。端点相接不算重叠；合法相交、嵌套和同起点不会被时间修复推开。
- 字词时间仍在所属字幕范围内；帧时间只是投影，不用前条字幕的结尾约束下一条。列表按开始时间稳定排序，绑定仍按 ID。
- 显示层由区间索引和稳定分层计算，缓存不落盘。层号不是说话人、内容角色或来源 ID；音频贴片的三层限制保持独立。

```json
{
  "schema": "msw.project.v2",
  "segments": [
    {"id": "speaker-a", "start": 0, "end": 5000, "text": "对话 A", "items": []},
    {"id": "speaker-b", "start": 2000, "end": 4000, "text": "对话 B", "items": []}
  ],
  "subtitle_layers": {
    "schema": "msw.subtitle_layers.v1",
    "allow_overlap": true,
    "legacy_overlay": {"visible": false, "cue_ids": []},
    "presentation": {"mode": "auto", "gap": 12, "order": "earlier-bottom"}
  }
}
```

`allow_overlap` 控制新编辑产生交叠的许可，不隐藏或删除已有重叠。`legacy_overlay` 专门保留旧叠加组的显示状态，其 `cue_ids` 只能引用主字幕、不得重复；删除成员会同步清理，撤销可恢复。首版保留单个历史组，不引入任意轨道管理。

可选 `presentation` 控制画面排布，不改变时间或视觉层身份。`mode` 为 `auto`／`manual`；`gap` 为 0–120 的整数，按 1080 高度折算；`order` 为 `earlier-bottom`（默认）／`earlier-top`。缺省使用自动避让、12 间距、先出现的组靠下。绑定主副成组排布，未绑定字幕独立排布；旧工程已有预览位置或烧录样式时迁移为 `manual`，由用户明确开启自动避让。正文、颜色、表情包、待校对与来源字段在主副快照中保持，派生缓存不落盘。

手动合并不新增 schema 字段：主、副角色的所选字幕及其显式绑定伙伴作为一次事务处理，多条变为新 ID，一条伙伴保持原 ID；用结果 ID 重建一对一绑定，offset 从两轨各自的合并范围重新计算。`C` 对 `disabled` 取 OR，对颜色／表情包取时间最早的非空内容；`Ctrl+Shift+C` 对 `disabled` 取 AND，颜色／表情包仅在全员内容相同时保留（忽略组索引和时间范围）。合并结果标记物化，其他条目的组引用修复但语义不变。`items` 保留原段内有效时间码，缺失时间码为 `[]`；不修改 `msw` 音频资源、贴片或历史来源引用。新旧工程均可一次撤销；旧工程连续性限制不变。

颜色标记身份按调色板 `name` 比较，旧工程存储的历史 `value` 不造成同名颜色冲突；表情包按内容比较，保留路径等实际参数。

### 确定性迁移

JS `MSWSubtitleLayers.migrate` 与 Python `migrate_project` 均返回独立副本、不写原文件。无版本／v1 输入执行迁移，显式未知或畸形版本拒绝。v2 输入保持幂等。

1. 对旧主／副／叠加字幕补齐缺失 ID；同一旧角色内部显式重号属于歧义，拒绝迁移。
2. 在排序和合并角色前，把 `color_ref`／`sticker_ref` 指向的值物化到每条字幕。保留颜色、说话人和表情包内容，时间范围使用所属字幕范围。
3. 旧 `overlay_track.segments` 归入主角色。主／叠加 ID 碰撞使用 `legacy-overlay-<原序号>`，必要时增加数字后缀；迁移不猜测过去转换时已经丢失的绑定。
4. 明确标明 `track_kind: "overlay"` 或 `role: "overlay"` 的来源引用转为主角色并同步 ID。候选与配方中的任意文本／不透明修订串不进行字符串替换；无法与当前目标快照一致的旧候选保持冲突保护。
5. 保存原叠加组 ID 集合及 `visible`。原隐藏组保持隐藏，可在字幕列表设置重新显示。旧重叠偏好取原 `enabled`；没有旧叠加字段的新工程默认允许。
6. v2 不再接受有内容的 `overlay_track`。当前旧辅助函数可能生成空叠加结构；读取器允许这个空占位，不把它当作第三种字幕角色。

### 写出、备份与旧格式出口决策

`buildJson()`、Python `serialize_mosp` 和服务器读写保留 v2。首次写回现有无版本／v1 工程时，先独占创建原字节备份，再原子替换正式工程；备份或替换失败不覆盖原工程。不允许用 v1 内容覆盖已有 v2 文件。

本机服务器备份名为 `<原文件名去扩展名>.v1-backup.mosp`，存在时增加 UTC 时间戳和递增序号，永不覆盖旧备份。浏览器文件句柄无法任意创建相邻文件，首次手动升级会请求选择空白备份文件；取消或原文件期间变化则停止覆盖。此模式首次静默自动保存要求先完成一次手动升级。直接下载新文件不会修改原文件。

「文件 → 保存 → 旧版工程（v1 兼容）」仅导出旧角色可表达的内容：每个主／副／旧叠加组内不得重叠；旧叠加组参与新绑定或处理记录时拒绝还原。组引用先物化再分轨；源工程不变。不能表达时提示使用新版工程、ASS 或合并显示 SRT，不静默删层。普通 SRT 保留时间重叠，但不保证外部播放器位置一致；合并显示 SRT 按所有时间边界切段拼接当前显示文本，只改变导出。

### 处理快照与结果

- v2 ASR／翻译任务快照带 `project_schema`。ASR 目标按角色和 ID 保存，应用重叠范围需要明确 `target_ids`；仅检查所选目标修订，保留其他层。截断且无可靠字词码的区外片段沿用原文并标记复核。
- 翻译仅处理明确选择的条目，副字幕按绑定 ID 回填；没有绑定时新增独立副字幕，不按时间接近程度猜配。导入副字幕只有双方唯一匹配时才建立绑定。
- TTS 冻结每条自身的来源 ID、角色、文字与时长参数；仅显示层变化不会触发素材来源变动。音频贴片仍最多三层，补齐字幕仍跳过有冲突的范围。
- CSS／ASS／视频使用共同的自动避让排布规则；默认预览、ASS 和视频烧录跟随工程字幕样式，校对预览和单次视频预设独立覆盖。禁用与历史隐藏组在输出中排除。OTIO 标记附带字幕身份，不能表达任意画面层次、字体和双语样式，不承诺无损往返。

实现与验证见 `docs/TEST_FEEDBACK_SUBTITLE_LAYERS_ABC_20261005.md`、`docs/TEST_FEEDBACK_SUBTITLE_LAYERS_DG_20261005.md`；用户入口见 `docs/EDITOR_SUBTITLE_LAYERS.md`。

### 导出任务下载名称

`POST audio-exports` 可携带 `project_name`（工程显示名，不含工程扩展名）。服务端生成并在任务中持久化 `download_name`，格式为 `工程名_MSW.mp4/wav/otioz`，空名称使用“未命名工程”，非法文件名字符和控制字符替换为下划线、工程名最多 120 字符；不接受该名称作为磁盘路径。名称参与新任务幂等快照，后续工程改名不影响已有结果。下载响应通过 ASCII 回退与 UTF-8 `filename*` 同时传递名称；没有此字段的旧任务继续使用原下载名。工程 JSON 不新增字段。
