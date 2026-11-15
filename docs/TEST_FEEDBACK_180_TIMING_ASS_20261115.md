# v1.8.0-beta.1 选择性跟进：插值切点与 ASS 不透明度

基线：`my-feature` / `c794d91f845e905aaa358dba15f9e73ec903bf10`。用户授权实施第 4 项，并确认 ASS 范围为描边／阴影独立不透明度，贯通 MSW 既有样式层级、预览与导出，保留旧工程外观。

| 项目 | 状态 | 决定 |
| --- | --- | --- |
| 粗时间戳拆分后的低能量切点吸附 | 已修复 | 仅调整本次拆分新增边界，最大 ±400ms；原始句界、间隙、可靠字词时间码和人工结果不移动。无音频／依赖／明显低谷时保留原时间，800ms 默认停顿切句不变。 |
| ASS 描边与阴影独立不透明度 | 已修复 | 接入工程、轨道、说话人、单条样式，统一预览／ASS／烧录；旧数据缺省时维持原外观。 |
| 回归、文档与交付 | 已修复 | 专项、完整 Python／Node 与浏览器回归通过，契约、使用说明、变更日志及共享产物同步；按已有授权提交推送 `my-feature`。 |

## 工作区与边界

- 保留既有 `debug.log`（35 行新增）、`.test-appdata/`、`output/`、`tests/test_data/_msw/`；不读取真实 `.env`，测试隔离。
- 不引入上游第二套 ASS 预览、符号样式解释器、默认样式变更或失败批次自动跳过。
- 不修改 `main`，不创建版本标签或发布。

## 进度与验证

- 已核对上次筛选报告和上游固定提交 `6fcf4289`；具体实现与验证结果持续记录于此。
- 切点实现采用 20ms RMS 窗口，只读取新增切点附近 ±400ms 音频。PCM16 WAV 使用标准库，其他格式可使用已安装的 soundfile；立体声按声道能量计算，避免反相信号抵消产生假静音。无明显低谷保持不动，同等低谷选择最近处，避免将字幕缩到 100ms 以下（已有短字幕至少保持原长度）。
- 本地与云端粗段、混合精度的云端句子均记录本次新切点；在空白／标点清理和范围偏移之前消耗资格，不向工程写入内部索引；音频读取失败时原时间整体保留。未改动人工编辑或可靠词级切分流程。
- `python -X utf8 -m unittest test_energy_valley test_qwen test_qwen_spacing test_local_asr test_packaging_contract`：146 项通过（8.5 秒），包含实际合成 WAV、平坦／全静音／反相立体声、短段、非零时间起点、采样率、原始边界、词级时间码、混合精度、过滤索引和打包依赖闭包。首次同组测试受隔离 TEMP 原子重命名限制出现 WinError 650，改用工作区隔离 TEMP/TMP 后通过。

## ASS 实施与阶段验证

- `outlineOpacity` / `shadowOpacity` 为 0–100 有限数字，缺省 100；复用属性面板字段、样式规范化、单条／说话人校验、预设和现有样式库。描边位于基础，阴影位于进阶，可独立恢复继承。`OutlineColour` / `BackColour` 写入对应 ASS alpha，启动器 `force_style` 也使用相同转换。
- 旧工程不自动转换或改外观；旧烧录快照只有用户明确编辑新字段时，才沿用原有转换提示进入工程 ASS 样式。独立文字背景使用自己的不透明度，ASS 底框使用描边不透明度。旧数据与显式 100 的 ASS 输出相同。
- 编译的新动画按分量乘上不透明度，兼容文字波动、打字机和背景；旧 `t` 动画也组合其 alpha 目标。参考 [ASS alpha 标签定义](https://aegisub.org/docs/latest/ass_tags/)：全局 alpha 覆盖四个分量，不能当成乘数。真实 libass 帧测试进一步发现，在同一个 transform 中依次写全局／分量 alpha 会重复插值，导致已隐藏阴影残留；改为每个分量只插值一次后通过。
- 浏览器近似预览、说话人标签和样式样张同步支持颜色 alpha；标准本机预览继续使用既有 libass。前后端呈现契约同步升至 23，避免旧服务静默忽略新字段；无工程版本升级。
- 专项：`python -X utf8 -m unittest test_ass_opacity test_ass_styles test_project_subtitle_style test_cue_style test_subtitle_animation test_subtitle_background test_subtitle_gradient test_speaker_palette`，63 项运行，62 通过／1 按现有条件跳过（10.8 秒）。新测试包含 Python／JS 归一化、0／小数、各层继承与恢复、保存往返、预览／导出一致、实际 FFmpeg 像素对比、动画乘法和底框。初次测试暴露夹具缺少前端依赖、错误 FFmpeg 时间写法以及上述动画问题，均修正后重新验证；首轮失败不计作通过。
- Node 全量 `node --test tests/test_*.mjs`：835 项全部通过（4.9 秒）。`editor.js`、`waveform.js` 语法检查通过；共享比较页面已用 `scripts/build_comparison_tools.py` 重建，未更新根目录历史便携 HTML。
- 浏览器 `ass-opacity.spec.mjs`：2 项通过（30 秒）。实际本机服务＋Chromium 验证轨道→说话人→单条继承、零值／小数、恢复、撤销重做、保存重开及 libass 波动时阴影全透明；已查看深色面板与实际渲染截图，浅色截图亦已生成。测试媒体与截图只保留在工作树外。

## 最终回归与交付边界

- 完整 Python：`python -X utf8 -m unittest discover -s tests -p "test_*.py"`，最终 2415 项运行，`OK (skipped=97)`，282 秒。使用新隔离配置和工作区 TEMP/TMP，未配置 FFmpeg 的全量组按既有环境条件跳过；FFmpeg 相关新功能已在上述专项中配置真实工具单独执行。
- 首轮全量的 3 项失败如实保留：比较页面的两份产物在检查开始后才完成重建；旧导出历史序号测试一次出现顺序不一致。重建后单独运行 `test_comparison_build test_msw_audio_exports`，20 项通过；未改导出历史代码，最终全量复跑也通过，不将首轮失败算作成功。
- 既有本机样式浏览器回归：`project-subtitle-style.spec.mjs --grep "saved presets do not mutate|project style renders|stale backend"`，3 项通过（34 秒），含真实播放器／FFmpeg 画面对照、预设保存重开和旧服务版本拒绝。合计本轮 5 项浏览器检查通过；已查看深浅主题截图，无新增独立弹窗。
- 补充实际 FFmpeg 帧检查：旧 `fad` 在中点时，50% 描边乘 50% 淡入，实测红色能量比 0.259；旧 `t` 变至全局半透明，中点实测 0.378（预期约 0.375）；两个场景的 0% 绿色阴影均无残留。
- UTF-8／LF／末尾换行、`git diff --check`、新增内容中的机器路径与凭据检查通过。`MSW.spec` 已覆盖本地／OCR 运行时对新切点模块的依赖，打包契约通过；本轮未重新构建发行包、未创建标签或 Release。
- 已修复项为表中三项；仅说明项、阻塞项均无。未验证真实模型下载／实机识别、收费云服务或用户长视频听校；切点安全边界由合成音频与管线回归验证，实际识别质量仍取决于引擎原始句界和音频。
- `main` 保持原提交，用户既有 `debug.log` 和测试／输出目录不纳入提交。更新后需重启本机编辑器服务，使后端与新页面同时加载呈现契约 23。
