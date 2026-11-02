# 编辑器设置与项目设置：归属和分类

阶段 1 盘点，2026-11-02；代码基线 `2725cbbb`。

本文保留阶段 1 的归属基线，并在此处记录实施进展。此前 [六阶段配置管理建设](CONFIGURATION_PLAN.md) 已提供公共保存与配置导入导出能力；本次在其基础上拆分设置窗口，不重建一套配置文件。

阶段 2 更新：保存隔离、字段级导出规则和旧值迁移已接入，详见 [实施记录](TEST_FEEDBACK_SETTINGS_MIGRATION_20261102.md)。下方现状与 84 项附录保留为阶段 1 的基线；现用规范化字段为 83 项，已移除无消费的 `splitAutoSubmit`。

阶段 3 更新：**编辑 → 编辑器设置／项目设置** 两个窗口已接入，分类按下表落地，共用布局及交互，独立记忆分类、搜索与位置。显示与播放提供现有模块设置的快捷入口；字幕与排布复用属性列表。配置管理归编辑器设置，当前说话人和轨道文字规则归项目设置。磁盘版本的手动操作移至 **文件 → 恢复记录**，备份频率仍在编辑器设置。时间基准调整可一次撤销／重做，详见 [实施记录](TEST_FEEDBACK_SETTINGS_WINDOWS_20261102.md)。

## 1. 归属规则

判断依据是“谁拥有这个值，以及改变它会影响什么”，不是控件现在放在哪里。

| 归属 | 判断方式 | 保存／生效规则 | 典型内容 |
| --- | --- | --- | --- |
| 编辑器偏好 | 换工程后仍希望沿用的操作和显示习惯 | 公共用户配置；本窗口即时或下一次操作生效 | 主题、界面语言、快捷操作、预览避让、自动保存间隔 |
| 项目设置 | 与这份作品的内容、解释或正式输出相关 | `.mosp`；走项目事务、撤销及保存 | 时间基准、说话人表、轨道语言与分组、正式字幕样式 |
| 可复用方案 | 可用于多个工程，但使用时应明确应用 | 用户配置中的方案库；应用后工程保存自己的快照 | 字幕样式预设、说话人方案、命名工作区 |
| 本机环境 | 依赖这台电脑或服务账号 | 专用本机存储；不混入工程和普通配置导出 | 密钥、业务空间、服务地址、模型路径、工具安装状态 |
| 本次任务 | 这次处理谁、处理哪段、怎样输出 | 开始时固定快照；运行中不受默认设置变动影响 | 所选字幕、翻译目标轨道、导出范围、输出文件、监听音量快照 |
| 会话／恢复状态 | 方便继续编辑，不是作品规则 | 现有会话、恢复记录或工程工作区；不当作用户可调参数 | 选中项、面板展开、播放头、进度、缓存、冲突记录 |

“记住上次选择”不等于项目设置。例如导出说话人名称可以记住默认选择，但本次导出的范围和轨道仍属于任务。模板或全局默认不能在打开已有工程时反向覆盖工程值。

普通 `.mswconfig` 保存可迁移偏好和方案库，`.mosp` 保存作品及其编辑现场。凭据、账号音色、媒体、波形缓存、任务结果不进入普通配置导出。工程当前说话人表与可复用说话人方案必须保持独立。

## 2. 两个窗口的分类方案

保留当前 MSWE 的左侧分类、右侧紧凑分组、提示 Icon 和搜索方式。仅适用条件成立时显示子选项；不增加一套复杂的设置树。顶部用一句话说明保存范围，不给每个控件重复加范围标签。

### 编辑器设置

| 分类 | 收纳内容 | 与现有入口的关系 |
| --- | --- | --- |
| 外观与语言 | 主题、配色、界面语言、提示显示 | 使用现有主题及语言配置，不重置个人配色 |
| 编辑操作 | 鼠标／键盘、吸附、切分确认、绑定选择、说话人自动跟随、合并字符 | “后方自动跟随”在这里；跟随形成的字幕引用仍随工程保存 |
| 显示与播放 | 波形、字幕列表、字幕编辑器、素材库的显示偏好；播放操作、预览样式选择与避让 | 模块设置按钮保留，打开或定位同一组控件，不维护第二份值 |
| 保存与备份 | 自动保存、磁盘历史备份的频率与数量 | 恢复某份工程的历史记录仍是工程操作，不塞进策略设置 |
| 服务与环境 | ASR／LLM／TTS 连接、本地运行时、媒体工具 | 与启动器复用现有服务接口；密钥和本机路径仍不导出 |
| 默认值与方案 | 已有处理默认值、字幕预设库、说话人方案、工作区库的入口 | 处理操作仍在各工具面板；不把预制工程表单整体搬过来 |
| 配置管理 | 导出、导入、详情说明 | 只放在编辑器设置内，不重回“窗口”菜单；保留现有导入机制 |
| 彩蛋 | 切分、胶带等效果与声音 | 使用当前开关，不新增特效功能 |

启动器“更多设置”继续使用页面式布局，不变成弹窗。它与编辑器共享配置来源和归属名称，不要求把启动器页面逐项复制成 MSWE 的分类。

### 项目设置

| 分类 | 收纳内容 | 边界 |
| --- | --- | --- |
| 时间与轨道 | 项目时间单位／帧率、现有轨道语言和文字计量规则、轨道分组信息 | 毫秒／帧快捷键步长仍是编辑器偏好；不更改字幕时间存储协议 |
| 说话人 | 当前工程的名称、多语言名称、显示勾选、颜色模式、分隔符、外观覆盖；方案应用与对应 | 不把工程内修改自动写回方案库；不改变稳定说话人 ID 或字幕引用 |
| 字幕与排布 | 工程默认样式、轨道样式、排布规则的概览及属性列表入口 | 单条、所选字幕的外观／动画继续在属性列表编辑，不复制整套属性面板 |
| 媒体与资源 | 工程媒体引用、表情包资源、已有音频空隙处理策略 | 不放服务密钥、模型目录；空隙生成和贴片编辑仍留在原工具 |

轨道重命名、主副分组、禁用、锁定等现有直接操作保留原入口。两窗口是设置归属的整理，不借机重做编辑器模块、轨道头或右键菜单。暂时没有可调内容的分类不显示空页。

“预览说话人”当前存于工程 `preview.speaker_labels_visible`，本次先保留其项目归属与播放器快捷入口，避免跨工程互相覆盖。单人的各语言名称显示勾选始终是项目设置；播放器总开关关闭时仍不显示名称。

## 3. 当前保存来源盘点

下表按数据域列出真实读写入口；编辑器偏好和波形偏好的逐字段清单在附录。启动器／ASR／TTS 等引擎内部参数沿用原 schema，不在本轮另抄一份默认模型名单。

| 数据域 | 当前来源和默认值依据 | 拆分后的处理 |
| --- | --- | --- |
| 编辑器偏好 | `browser.moy.asr.editor.settings.v1`；`web/editor-utils.js::normalizeEditorSettings` | 按附录 A 分组，存量值原样保留；兼容字段不成为新控件 |
| 波形偏好 | `browser.moy.asr.waveform.settings.v1`；`web/waveform.js::DEFAULT_SETTINGS/readSettings` | 编辑器默认显示 + 当前工作区状态，见附录 B |
| 工程工作区 | `.mosp.workspace`；`getLayoutData/buildCurrentWorkspaceData`；含 `editorDisplay` 和导航 | 恢复项目现场，不能隐式更新个人默认；不从 `.mosp` 删除布局或播放头 |
| 工作区库 | 公共配置 `server.saved_workspaces/preset_workspaces/active_workspace_name` | 个人可复用方案；显式保存／切换，导出不含导航历史 |
| 打开上次工程 | 公共配置 `server.auto_open_last_project` | 启动／编辑器操作偏好；具体最近工程路径仍是本机记录 |
| 主题和界面语言 | editor settings、`customThemes`、`themeCustomColors`、`mawe.language` | 编辑器外观；默认值由现有主题和语言规范化代码决定 |
| 独立预览样式 | `browser.msw.subtitle-proof.v1`；`web/msw-project-style-ui.js`，默认跟随工程 | 编辑器显示偏好；切换预览不修改工程正式样式 |
| 正式字幕外观与动画 | `preview.project_style`、`subtitles` 的轨道／字幕覆盖、说话人覆盖；`project_subtitle_style.py` 等规范化器 | 项目拥有；保留当前“单条覆盖优先于说话人、说话人优先于轨道”等实际合成规则，不在搬窗口时重算 |
| 字幕预设库 | 公共配置 `subtitlePresets`；`msw.subtitle-presets.v1`；内置预设来自代码 | 用户库和内置预设不迁进项目；工程只保存已应用样式及选择信息 |
| 工程说话人 | `preview.speaker_palette`；`web/msw-speaker.js`、`maw/msw/speaker_palette.py` | 迁移表格入口；名称、各语言显示、颜色、分隔符、外观、动画、引用归属保持 |
| 说话人方案库 | 公共配置 `speakerSchemes`／`msw.speaker-schemes.v1`；`maw/msw/speaker_schemes.py` | 在库中管理，在项目中确认对应后应用，禁止凭名称或排列自动重绑 |
| 时间基准 | `.mosp.timebase`；`JSON_SCHEMA.md`，缺失按毫秒兼容；媒体 FPS 仅提供初值 | 移到项目设置；吸附习惯、显示分隔符和微调步长不随之迁入项目 |
| 轨道和字幕规则 | `subtitles.tracks/cues/bindings`，`split_mode/language`、分组、锁定等；`subtitle_view` 视图记忆 | 项目数据；继承／绑定关系不受用户配置导入影响 |
| 音频及空隙 | `msw.audio_tracks/audio_clips/audio_settings`、`gap_remove`；热力图缺省 true，空隙策略缺省 protect | 当前项目数据先保持现有协议；空隙参考轨道、标记与任务参数分别处理 |
| 表情包资源 | `.mosp.sticker_root`、字幕资源引用；当前读取工程时恢复根目录 | 项目资源路径与全局资源默认分开；是否预览是用户偏好，打包方式是导出选项 |
| 配置管理 | `maw/user_config.py`、`web/msw-config*.js`、`maw/config_transfer.py` | 共用现有 `.mswconfig` 格式及冲突控制；只迁入口及分类说明 |
| 翻译和处理默认值 | `msw.translation.call.v1`、`maw.launcher.llm.prompts`、`maw.launcher.alignment.gap_remove`、`defaults.postprocess` | 用户默认；作用轨道、文件依赖及本次输入另存任务，不加入全局默认 |
| 预制工程习惯 | 公共配置 `launcher` 的 12 个 `ENV_KEYS`；`maw/gui_config.py` | 用户偏好：语言／模型记忆、模块选择、断句限制、输出组织、完成通知等；不是已打开项目的规则 |
| 启动器面板记忆 | 公共配置 `browser.MSW_*` 登记项 | 用户界面状态；旧模块缓存 `MSW_LAUNCHER_MODULES_V1` 由专用逻辑迁到预制模块偏好 |
| TTS 参数 | 公共配置 `defaults.tts`；`maw/config_defaults_schema.py`、各引擎规范化器 | 可复用参数是用户默认；所选字幕／文本是任务输入，合成素材与贴片是项目内容 |
| 自动保存／版本备份 | editor settings；`defaults.recovery`，版本策略默认开启／300 秒／20 份 | 两者均为编辑器保存策略；恢复草稿和磁盘历史文件不是可导出的设置 |
| 本机服务和账号资源 | `maw/gui_config.py`、现有服务配置接口和资源库；不读取个人密钥文件做盘点 | 编辑器／启动器环境入口；普通导出排除密钥、账号资源、安装路径 |
| 工具／导出任务 | 处理面板构建的请求、视频／音频／字幕导出快照 | 继续留在工具面板；任务开始后固定，工程及用户默认变动不改运行中的任务 |
| 面板位置和工具折叠 | `maw/user_config.py::REGISTRY` 中 panels 类 | 保留原位置键；新窗口分别记忆位置／分类，旧值仅作为一次性初值 |
| 素材库显示 | `msw.assets.columns/showPlayer/showChanges`、`assetLibraryShowSearch` | 编辑器显示偏好；素材、合成来源和引用另随项目保存 |
| 历史、恢复和缓存 | 本机工程登记、会话／恢复库、波形 sidecar、字体／媒体缓存 | 不作为两窗口的普通可迁移选项；不恢复“清理重复波形缓存”或“配置快照回退”按钮 |

项目设置字段的默认值继续来自工程规范化器，不从当前个人工程抽取。旧工程已经保存的外观、时间与人物设置优先；缺失字段才使用既有兼容规则。这里的“默认”不是用户当前个性化配置。

## 4. 已确认的混合归属和兼容负担

| 编号 | 证据／现状 | 后续施工约束 |
| --- | --- | --- |
| S01 | `editor.js::applyEditorDisplaySettings` 恢复工作区的 7 个显示字段时调用 `updateEditorSettings`；打开工程也走这条路径 | 拆开“应用当前工作区显示”和“保存用户默认”。只恢复工程不得写回公共偏好 |
| S02 | 波形布局存在公共默认和 `.mosp.workspace` 两处；`setLayoutData` 有 persist 参数，布局恢复还有直接保存路径 | 审核打开、恢复、撤销、命名布局切换全部调用者；明确只有用户主动保存默认才反向写公共库 |
| S03 | 全局设置的“时间基准”混合项目 `timebase` 与用户 `timelineSnapToFrame`、`timelineTimecodeSeparator` | 移动项目字段，操作选项留在编辑器；不把媒体 FPS 当作项目可随意改写的源信息 |
| S04 | 说话人色系表是项目数据，但同区 `speakerAutoFollow` 是用户偏好 | 拆开归属；关闭自动跟随不删除已产生的引用或颜色；保留用户已确认的同轨停止边界规则 |
| S05 | `preview` 名称下同时有正式渲染样式、名称显示和预览字段；另有本机 proof 选择 | 禁止按对象名整包迁移。正式渲染必须仍由项目决定，独立预览不能进入烧录结果 |
| S06 | `mainSplitModeOverride` 等旧主副设置和 `splitAutoSubmit` 仍被规范化；部分已无当前交互消费路径 | 兼容读取，不给新窗口增加旧“启用多重字幕”“自动提交”等按钮；轨道计量以实际轨道字段为准 |
| S07 | 旧 ASS 样式库、五色色表及迁移标记仍存在；配置导出按整个偏好对象选取 | 标出兼容字段，不能把它们显示为新功能。过滤或删除旧字段需单独验证，不能在搬控件时直接丢弃 |
| S08 | `editor-utils.js` 有规范化默认，`editor.js` 另有兜底默认，波形还有 7 个显示默认 | 后续统一通过已有规范化接口取值；工作区模板允许有显式显示覆盖，不增加第三份默认表 |
| S09 | 公共配置 `REGISTRY` 登记到存储项；一个 editor settings 对象内有偏好、工具默认和兼容字段 | 下一阶段需补字段级归属元数据及校验；不是简单把整个对象分成两个名字 |
| S10 | 当前总控表格、属性模块、播放器、导出面板均可影响说话人显示 | 保留“每语言显示 × 播放器总开关／导出任务开关”的规则；导出临时字段不得回写工程 |

以上是源码核对结果，不表示已修改这些路径。现有文档曾将“恢复工程布局不改用户默认”写为已成立；本轮纠正为待落实的边界规则。

## 5. 后续迁移与交互约定

1. **先标字段，再移动控件。** 为每项声明归属、默认值函数、读写接口、生效范围、是否参与项目撤销、配置导出类别。沿用现有存储键，不仅为了重命名窗口就提升工程版本。
2. **先复用，再拆入口。** 把当前全局设置拆为“编辑器设置”“项目设置”；旧模块设置保留快捷入口，并定位同一控件。属性列表和任务工具不并入大设置页。
3. **只迁有依据的值。** 用户偏好保持原值；项目值从项目读。旧全局值只有在项目对应字段缺失且既有迁移规则允许时才作初值，不能广播到所有工程。
4. **恢复与默认分别写入。** 工程工作区只改当前实例的有效显示状态；显式保存工作区／个人默认才写用户库。多窗口仍用已有字段冲突检查，不在后台强制刷新别人的布局。
5. **项目修改属于一次编辑。** 项目设置变更可撤销、标记未保存；一次说话人总控或轨道规则操作只建一次事务。主题、浮窗位置、打开设置页不压入项目撤销栈。
6. **即时反馈，不重复保存。** 维持现有即时应用；拖动颜色、字号、数值时合并事务及预览更新。移动控件不能增加整项目快照或每个输入字符全量重绘。
7. **配置导入保持独立。** 导入偏好／预设库不自动应用到当前作品；使用方案依旧明确对应人物。只保留公开的导入与导出，内部备份仍用于防损坏。
8. **任务边界不变。** 模型、思考强度、源／目标轨道、导出范围在开始时冻结；设置窗口切换不取消、不重建已有任务。
9. **恢复默认只作用当前范围。** 编辑器分类恢复用户默认；项目样式沿用当前预设的恢复规则；单条属性恢复继承。不能用一个“恢复全部”跨越个人配置和工程。
10. **入口和文字同步。** 编辑菜单并列两个设置入口；配置管理归编辑器设置；现有快捷入口、搜索词、帮助及提示同步更新。迁移结束后避免“全局”同时指用户和工程。

不新增本轮未要求的项目模板、第三种设置文件、快捷键录制器、服务自动测试或资源管理器。现有需要重启的环境项沿用原机制，其他项不统一要求重启。

## 6. 后续验收条件

| 场景 | 必须成立 |
| --- | --- |
| 新建工程／旧工程打开 | 个性化偏好保留；旧样式、帧率、轨道、说话人、引用不变 |
| 工程 A／B 切换 | 人物、样式、播放头各自恢复；恢复工作区不修改另一个工程或个人默认 |
| 设置撤销 | 项目修改一次撤销；个人外观／面板导航不影响项目撤销历史 |
| 两窗口改不同个人字段 | 允许合并；同字段冲突明确反馈，不静默覆盖 |
| 配置导入／部分导入 | 只影响所选用户分类；不修改打开的项目、运行任务、账号凭据 |
| 重启／换端口／换浏览器 | 本机服务模式下同一配置来源；便携离线模式继续按既有能力处理 |
| 预览、字幕导出、烧录 | 相同工程得到原有正式结果；预览覆盖和导出任务选项不渗入工程 |
| 工作区／模块设置 | 模块入口和设置窗口读到同一有效值，布局恢复不新建空撤销记录 |
| 长工程 | 打开分类及修改偏好不全量扫描字幕；项目改动沿用增量事务与预览刷新 |
| 界面 | 紧凑、响应式、浅深主题一致；不出现旧多重开关、ASS 方案库或重复设置 |

## 附录 A：编辑器偏好逐字段清单

覆盖 `normalizeEditorSettings({})` 返回的 **84 项**。默认值是本次基线快照，运行时仍以源函数为准。整表当前保存于公共 `browser.moy.asr.editor.settings.v1`，不是新 schema。

归属缩写：**E** 编辑器偏好；**W** 编辑器偏好且当前也在工程工作区内保存有效显示；**T** 工具的可记忆默认值，实际操作在工具面板；**L** 旧兼容字段，不公开新控件；**I** 内部状态，不公开设置。L／I 目前部分仍随整个对象进入配置包，后续不能把“目标归属”误当作已经有逐字段导出过滤。

| 字段 | 当前默认 | 目标归属／分类与说明 |
| --- | --- | --- |
| `splitKey` | `enter` | E · 编辑操作／文字切分键 |
| `splitUseWordTimestamps` | `true` | E · 编辑操作／逐词时间 |
| `splitAutoSubmit` | `true` | L · 当前只见默认／规范化，无实际自动提交消费；不复活旧开关 |
| `mainSplitModeOverride` | `null` | L · 旧主轨计量覆盖，现应从各轨道读取 |
| `splitTrimSymbols` | `["，","。","、","！","？",",","."]` | E · 编辑操作／切分清理；与 ASR 断句规则分开 |
| `overlayEnabled` | `true` | E · 显示与播放／预览字幕 |
| `extensionOverlayEnabled` | `true` | E · 显示与播放／预览副字幕；保留现有轨道映射 |
| `assMode` | `false` | L · 旧 ASS 显示开关 |
| `multiSubtitleRowHeight` | `168` | L · 旧双轨高度，平级轨道采用现波形高度规则 |
| `flatTrackSettingsMigrated` | `false` | I · 平级轨道偏好迁移标记 |
| `subtitleColorPaletteEnabled` | `false` | L · 旧五色映射启用标记 |
| `speakerAutoFollow` | `false` | E · 编辑操作／后方同轨自动跟随；非项目说话人表 |
| `exportStartAtZero` | `false` | T · 导出时间从零开始 |
| `cueListShowIndex` | `true` | W · 字幕列表／编号 |
| `cueListShowTime` | `true` | W · 字幕列表／时间 |
| `cueListShowSticker` | `true` | W · 字幕列表／表情包 |
| `cueListShowCharcount` | `true` | W · 字幕列表／字数 |
| `cueListFollowPlayback` | `true` | E · 字幕列表／跟随播放 |
| `cueListPairLayout` | `columns` | E · 字幕列表／对应卡片排列 |
| `cueListHideDisabled` | `true` | E · 字幕列表／禁用内容显示 |
| `cueListCharcountThreshold` | `0` | E · 字幕列表／字数提示阈值 |
| `cueEditorShowNavigation` | `false` | W · 字幕编辑器／导航 |
| `cueEditorShowTimeActions` | `false` | W · 字幕编辑器／时间操作 |
| `cueEditorShowSticker` | `false` | W · 字幕编辑器／表情包 |
| `cueEditorCancelOnEscape` | `false` | E · 编辑操作／Esc 行为 |
| `selectGroupMembers` | `false` | E · 编辑操作／标记引用组选择 |
| `toolbarKbdHints` | `false` | E · 外观与语言／按键提示 |
| `cueEditorSplitMoreActions` | `false` | E · 编辑操作／联动切分更多操作 |
| `cueEditorSplitAutoClose` | `true` | E · 编辑操作／现 UI 为“自动切换”，保留旧键名 |
| `ttsDraftClearOnSuccess` | `true` | E · 编辑器／配音草稿成功后清空 |
| `ttsDraftSplitLines` | `true` | E · 编辑器／配音草稿按行 |
| `ttsDraftSplitMode` | `off` | E · 编辑器／配音草稿切分 |
| `ttsDraftSplitPunctuation` | `。！？!?；;` | E · 编辑器／配音草稿断句符号 |
| `ttsDraftSplitLimit` | `100` | E · 编辑器／配音草稿阈值 |
| `mergeJoinTextContinuous` | `""` | E · 编辑操作／字符型拼合连接文字 |
| `mergeJoinTextWord` | `" "` | E · 编辑操作／单词型拼合连接文字 |
| `autoMergeGapMs` | `200` | T · 拼合字幕／间隔阈值（毫秒） |
| `autoMergeSnapDirection` | `backward` | T · 拼合字幕／对齐方向 |
| `autoMergeShortCount` | `3` | T · 拼合字幕／短句阈值 |
| `autoMergeSnapGaps` | `true` | T · 拼合字幕／贴合间隔 |
| `autoMergeStateMode` | `union` | T · 拼合字幕／累加状态 |
| `autoMergeAbsorbShort` | `true` | T · 拼合字幕／吸收短句 |
| `autoMergeAbsorbDirection` | `previous` | T · 拼合字幕／短句归并方向 |
| `exportColorUnified` | `true` | T · 字幕导出颜色选项 |
| `exportSpeakerLabels` | `false` | T · 导出说话人名称；非预览总开关 |
| `exportSpeakerNamesAsSuffix` | `false` | T · 分色文件命名选项；不放进项目人物表 |
| `autoSaveProject` | `true` | E · 保存与备份／自动保存 |
| `autoSaveIntervalSeconds` | `30` | E · 保存与备份／间隔（秒） |
| `stickerOverlayEnabled` | `false` | E · 显示与播放／预览表情包 |
| `stickerOtioExportMode` | `original` | T · 剪辑工程／表情包资源打包 |
| `clickBehavior` | `select-and-seek` | E · 编辑操作／点击行为 |
| `clickTarget` | `pointer` | E · 编辑操作／点击定位基准 |
| `pauseOnMouseClick` | `false` | E · 编辑操作／点击暂停 |
| `otioExportIncludeSrt` | `true` | T · 剪辑工程／附带字幕 |
| `otioExportIncludeStickers` | `true` | T · 剪辑工程／附带表情包 |
| `otioExportIncludeMarkers` | `true` | T · 剪辑工程／附带标记 |
| `keyboardOperationReference` | `pointer` | E · 编辑操作／键盘定位基准 |
| `jklPlaybackMode` | `direction` | E · 显示与播放／JKL 模式 |
| `mediaSeekStepMs` | `1000` | E · 显示与播放／跳转毫秒步长 |
| `mediaSeekStepFrames` | `1` | E · 显示与播放／跳转帧步长 |
| `cueMoveStepMs` | `50` | E · 编辑操作／字幕微调毫秒步长 |
| `cueMoveStepFrames` | `1` | E · 编辑操作／字幕微调帧步长 |
| `timelineSnapToFrame` | `true` | E · 编辑操作／贴齐帧；非项目 FPS |
| `timelineTimecodeSeparator` | `:` | E · 显示与播放／时间码显示 |
| `hoverSeekPreview` | `false` | E · 显示与播放／悬停预览 |
| `subtitleAvoidControls` | `true` | E · 显示与播放／预览避让控制条 |
| `autoSnapAdjacentCues` | `true` | E · 编辑操作／相邻边界吸附 |
| `ninjaMode` | `false` | E · 彩蛋／切分模式 |
| `mergeTapeEffect` | `false` | E · 彩蛋／合并胶带 |
| `ninjaSound` | `true` | E · 彩蛋／声音 |
| `ninjaSlashEffect` | `true` | E · 彩蛋／切分效果 |
| `ninjaSlashLengthPercent` | `80` | E · 彩蛋／长度比例 |
| `ninjaSlashRotateAmplitude` | `6` | E · 彩蛋／角度幅度 |
| `crossTrackSnap` | `true` | E · 编辑操作／跨轨吸附；不改变 Shift 激活规则 |
| `selectBoundSubtitlePair` | `false` | E · 编辑操作／同时选中绑定字幕 |
| `multiSubtitleAutoSyncDuration` | `true` | E · 编辑操作／绑定时同步时间；绑定结果属项目 |
| `theme` | `dark` | E · 外观与语言／明暗主题 |
| `waveShapeSource` | `reapeaks` | E · 波形／显示数据源；实际波形仍是可重建缓存 |
| `assetLibraryShowSearch` | `true` | E · 素材库／搜索框 |
| `themePreset` | `default` | E · 外观与语言／主题预设 |
| `accent` | `blue` | E · 外观与语言／强调色方案 |
| `colors` | `null` | E · 外观与语言／自定义颜色 |
| `subtitleColorPalette` | 旧五色表，见下文 | L · 旧工程说话人迁移输入，非当前项目表 |
| `exportSpeakerLabelsExplicit` | `false` | I · 区分用户显式导出选择与兼容默认 |

旧五色默认表：yellow `#c4a019`、green `#66bb6a`、red `#f07f6f`、purple `#bf89e6`、blue `#61a7fa`。它与 UI 主题色不是同一套配置。

## 附录 B：波形与工作区逐字段清单

覆盖 `web/waveform.js::DEFAULT_SETTINGS` 的 **20 项**。**W** 表示目前 `getLayoutData()` 会写入工程工作区；**E** 是个人显示偏好；**I** 是内部界面状态。W 恢复时应只改变当前实例，不代表用户默认已被主动修改。

| 字段 | 当前默认 | 归属／说明 |
| --- | --- | --- |
| `mode` | `multi` | W · 多行／单行显示 |
| `layout` | `wave-right` | W · 工作区布局预设 |
| `visibleSeconds` | `20` | W · 可视时间 |
| `secondsPerRow` | `10` | W · 每行时长 |
| `rowHeight` | `120` | W · 行高 |
| `side` | `left` | W · 波形布局方向 |
| `splitPercent` | `60` | W · 区域比例 |
| `layoutColumnPercent` | `30` | W · 列比例 |
| `layoutRows` | `[42,16,42]` | W · 行比例 |
| `layoutTree` | `DEFAULT_RIGHT_LAYOUT_TREE` | W · 模块 Dock 树 |
| `hiddenModules` | `["assets","properties"]` | W · 隐藏模块 |
| `layoutEditing` | `false` | I · 当前布局编辑状态；不增加普通设置选项 |
| `waveformScale` | `1` | W · 显示振幅，不修改实际音量 |
| `waveformScaleAuto` | `true` | W · 自动显示振幅 |
| `followSourceGain` | `false` | W · 跟随试听增益显示，不改变源音频 |
| `disabledDisplay` | `dim` | W · 禁用块的可视方式 |
| `showTrackHeads` | `true` | W · 轨道编号 |
| `hoverDetails` | `false` | W · 悬停详情 |
| `dragPlayhead` | `true` | W · 拖动播放头 |
| `spectralColor` | `false` | E · 频谱着色；当前不在 getLayoutData 的 waveformSettings 中 |

## 附录 C：盘点依据与限制

- [原配置存储清单](CONFIGURATION_INVENTORY.md)、[当前配置管理](CONFIGURATION_MANAGEMENT.md)、[工程协议](../JSON_SCHEMA.md)。
- `web/editor-template.html` 及 `web/editor.js`：真实控件、动态分类、设置事件、保存和工作区恢复调用。模板中存在不代表运行时仍可见，已检查动态隐藏的旧字幕样式区。
- `web/editor-utils.js`、`web/waveform.js`：84 项编辑器归一化字段、20 项波形默认字段及工作区序列化。
- `maw/user_config.py`：公共浏览器登记项、12 项启动器迁移字段和 4 项 server 偏好；`maw/config_transfer.py`：公开导出类别和已退役类别。
- `maw/config_defaults_schema.py`、`maw/gui_config.py`：处理默认值、模块选择、模型环境边界；没有读取个人环境文件或凭据。
- 只验证源码归属和文档覆盖。本阶段没有进行设置迁移或浏览器交互验收；后续必须依第 6 节验证，不得把本次盘点当作已经修复 S01–S10。
