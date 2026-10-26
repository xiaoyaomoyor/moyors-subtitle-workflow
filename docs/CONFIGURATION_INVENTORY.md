# 配置清单与保存规则

对应六阶段方案的第 1–4 阶段。导入导出入口、分类与生效规则见 [配置管理](CONFIGURATION_MANAGEMENT.md)。公共接口为 Python `maw.user_config.UserConfig` 与浏览器 `MSWConfig.storage`；登记表 `maw/user_config.py::REGISTRY` 同时提供给启动器和编辑器，不分别维护两份浏览器键名清单。

## 唯一保存来源

| 配置／数据 | 内容及默认来源 | 保存来源 | 可迁移导出 | 生效时间 |
| --- | --- | --- | --- | --- |
| 编辑与播放偏好 | 切分、拼合、列表、字幕编辑器、快捷键步长、预览避让、试听、彩蛋、自动保存；`web/editor-utils.js::DEFAULT_EDITOR_SETTINGS` 与 `normalizeEditorSettings` | 公共库 `browser.moy.asr.editor.settings.v1` | 是 | 当前窗口即时；其他窗口重开后读取 |
| 波形与默认布局 | 模式、每行时长、高度、轨道头、悬停、拖动播放头、频谱颜色、Dock 布局；`web/waveform.js::DEFAULT_SETTINGS/readSettings` | 公共库 `browser.moy.asr.waveform.settings.v1` | 是 | 同上；载入工程布局不改用户默认 |
| 界面主题 | 内置主题选择、颜色、用户主题、颜色暂存；`web/editor.js` 主题定义和规范化 | 公共库 editor settings、customThemes、themeCustomColors | 是 | 当前窗口即时 |
| 编辑器语言 | `web/editor-i18n.js::normalizeLanguage`，默认中文 | 公共库 `browser.mawe.language` | 是 | 当前窗口即时 |
| 独立预览样式选择 | `web/msw-project-style-ui.js` 的 proof 状态，默认跟随工程 | 公共库 `browser.msw.subtitle-proof.v1` | 是，须检查预设依赖 | 下次预览；不修改工程样式 |
| 字幕样式预设库 | 用户保存的外观、动画、字体类别等；`maw/project_subtitle_style.py::normalize_presets`，用户库默认空，内置预设来自代码 | 公共库 `subtitlePresets` | 是 | 新应用预设时；已写入工程的样式保持原值 |
| 说话人方案库 | 名称／译名、颜色、分隔符、外观及动画覆盖；`maw/msw/speaker_schemes.py::validate`，默认空库 | 公共库 `speakerSchemes`，浏览器键 `msw.speaker-schemes.v1` | 是，独立分类 | 工程内确认对应并应用时；导入配置不改变工程人物 |
| 旧 ASS 样式库 | `maw/ass_styles.py::default_ass_style_library/normalize_ass_style_library`，仅内部旧协议保留 | 公共库 `assStyles` | 不再提供可选分类；内部备份仍保留 | 旧内部调用 |
| 工作区库 | 保存的工作区、内置布局覆盖、当前工作区；`ServerSettings` 与 `normalizeLayoutData` | 公共库 `server` | 是，排除导航历史 | 显式切换／新打开编辑器 |
| 启动器通用偏好 | 语言、主题、缩放、常用语言、上次模型／识别语言、输出子目录、模型名后缀、完成通知、预制模块、断句限制；`maw/gui_config.py::EffectiveConfig/effective_config` | 公共库 `launcher`（原 GUI 环境字段为迁移输入） | 是 | 界面即时或下一次任务；已运行任务不变 |
| 启动器界面记忆 | 当前页面／工具、设置页、日志卡、工程分组折叠；各 `web/launcher/*.js` 常量 | 公共库 `browser.MSW_*` 登记项 | 是 | 新打开窗口 |
| 文本处理偏好 | 翻译调用选择、语言／提示词、启动器 LLM 提示词和口播对齐空隙参数；各处理模块的 defaults/normalize | 公共库对应 `browser` 项 | 是 | 下一次调用 |
| 面板位置与折叠 | 各浮窗 position key，未保存时由布局代码居中／锚定 | 公共库 `browser` 的 panels 分类 | 是 | 下次打开面板；小屏仍由布局代码约束 |
| 素材库显示 | 列数、播放器、变化标记；`web/msw-asset-library.js` | 公共库 browser 对应三个字段 | 是 | 下次打开／本窗口操作即时 |
| 引导状态与内部迁移标记 | onboarding status、旧列表开关修正标记 | 公共库 `browser`；迁移旧服务端引导状态，旧接口也读写公共库 | 不再提供引导状态分类；迁移标记不导出 | 下次打开 |
| 工程内容 | 字幕轨道／对应关系、单条外观／动画／位置、空隙、贴片、工程工作区、媒体引用；`JSON_SCHEMA.md` | `.mosp` | 随工程，不进入用户配置 | 工程编辑／保存 |
| 工程恢复与导航 | 恢复草稿、savedAt、临时平级轨道交接、工程选中项 | 工程恢复库、原项目专属浏览器键／sessionStorage | 否 | 当前工程 |
| 项目目录与历史 | 最近／全部工程、固定／NEW、媒体索引 | `server-editor-settings.json` 的 recent_projects、launcher registry／recent／media index | 否（本机工作记录） | 即时 |
| 当前任务 | 文件队列、轨道范围、识别／导出参数快照、任务进度／结果 | 工作数据库及任务对象；批处理草稿本地存储 | 否 | 启动任务时固定 |
| 磁盘版本备份策略 | 开启、间隔、保留份数；`maw/msw/versions.py::DiskVersions.settings` 默认 true／300 秒／20 份 | 公共库 `defaults.recovery`；原环境字段仅首次迁移 | 是，独立分类 | 下一轮备份 |
| 后处理自动流程 | 文稿／替换规则／OCR／LLM 步骤，含文件依赖；`maw/postprocess_pipeline.py::default_postprocess_plan/normalize_plan` | 公共库 `defaults.postprocess`；专用文件保留文件依赖与验证记录 | 是，排除文件／轨道引用 | 下一次预制；本轮保持专用读写 |
| TTS 引擎与配方 | 各引擎 recipe、语速、音色引用；各 `maw/msw/*tts.py` 的 DEFAULT_RECIPE / normalize | 公共库 `defaults.tts` 保存公共参数；专用库保留账号音色、连接与参考音频 | 是，仅公共参数及配方库 | 下一次合成；本轮保持专用读写 |
| 模型与工具环境 | ffmpeg、模型缓存、运行时／服务地址、设备、安装状态、本地 ASR 模型路径 | `.env` 环境字段、runtime manifests、TTS service settings、`msw.local-asr-options` | 默认不导出 | 工具重启或下一次运行，以模块规则为准 |
| 凭据与账号资源 | API Key、鉴权、业务空间、账号音色、参考音频、模型连接验证 | `.env`／专用账号资源库 | 不进入普通配置文件；本轮不迁移 | 下一次连接 |
| 媒体缓存 | mopeaks、quapeaks、ReaPeaks、代理、字体缓存 | 原缓存目录／媒体 sidecar | 否 | 可重建；第五阶段统一 |

第二阶段统一浏览器偏好；第三阶段增加 `defaults` 公共参数适配。原处理接口继续使用，公共参数从统一库覆盖，连接／资源仍留在专用库。旧文件保留，不作为已迁移字段的反向覆盖来源。

## 格式与优先级

`user-settings.mswconfig` 为 UTF-8 JSON，位于 MSW 应用数据目录。使用 `MSW_APP_DATA_ROOT`（兼容 `MAW_APP_DATA_ROOT`）可指定便携数据根目录。显式传入独立环境文件的工具／测试，在无应用数据根覆盖时使用该文件所在目录，避免混入日常偏好。

```json
{
  "format": "msw-config",
  "version": 1,
  "revision": 1,
  "sections": {
    "browser": {},
    "launcher": {},
    "server": {},
    "subtitlePresets": {"version": 1, "presets": []},
    "assStyles": {}
  },
  "migrations": [],
  "applied": []
}
```

这是结构示意，省略分类表示使用模块默认；实际样式库必须满足对应规范化规则。`revision/migrations/applied` 是本机保存元数据，第三阶段独立导出时不把它们当用户偏好导入。

优先级：显式进程环境覆盖 > 公共库用户值 > 首次迁入的旧值 > 模块默认。工程中的样式、位置和工作区由工程决定，预览覆盖只是显示选择；配置读取不会改写工程。运行中的任务继续使用启动时快照。

## 迁移、保存与恢复

- 首次读取服务器外观／工作区、ASS／字幕预设文件，只迁入登记字段。首次打开每个浏览器源时，迁入其旧偏好；公共库已有的值优先，不被旧端口缓存反向覆盖。
- 旧环境文件只迁移 `ENV_KEYS` 明确列出的 GUI 偏好，不复制整个环境。旧密钥、工具路径保持原用途。以后修改这些 GUI 偏好只写公共库；手改旧 `.env` GUI 行不再覆盖已迁移值，显式进程环境变量仍可临时覆盖。
- 原始旧文件保留。`config-migration-backups/*.mswconfig` 保存非敏感迁移输入；浏览器 `msw.config.legacy.v1` 保存登记项的迁移快照。浏览器项目草稿不进入这些快照。
- 所有写入使用操作系统文件锁、同目录临时文件、flush/fsync 和原子替换；`.mswconfig.bak` 是上一次成功覆盖前的版本。遇到损坏或未知版本拒绝覆盖，不静默重置个人设置。
- 客户端提交改动字段及旧值，服务器合并不同字段。同一字段冲突时拒绝整个批次，并在右上角提示；本地 `msw.config.conflict.*` 保留被拒绝的改动。刷新读取已保存值后可重新调整。配置管理提供导入前快照回退；被拒绝的窗口改动继续保留在本机恢复副本中。
- 断网／服务重启时改动留在 `msw.config.pending.v1`，恢复后重试；操作 ID 防止“服务器已保存但响应丢失”造成重复应用。尚未保存时离开页面会触发浏览器离开确认。
- 便携 HTML 没有本机服务时继续使用浏览器本地配置，不能宣称跨浏览器自动同步。第三阶段的独立配置文件用于离线搬运。
- 其他已打开的窗口不会强行切换主题、布局或任务选项；新打开／刷新读取公共库。旧窗口只发送实际改动，同字段冲突要求刷新，避免热更新正在编辑的工程。

## 默认值与登记维护

不复制一份默认值到存储层。缺省值仍由上表对应规范化函数产生；登记表只记录归属、编码、可导出性与生效时机。新增偏好必须登记后才能经公共配置接口迁移，未知浏览器键继续走本地存储，服务端拒绝未知分类／键。修改某个默认值应同时修改原模块的 defaults/normalize 与其测试。

具体浏览器键及分类见本文件下方自动盘点；编辑器和波形字段在原默认常量中逐项定义，避免文档副本与运行时默认发生漂移。

## 浏览器登记项

| 键 | 分类 | 编码 | 保存路径 |
| --- | --- | --- | --- |
| `moy.asr.editor.settings.v1` | editor | json | `browser / moy.asr.editor.settings.v1` |
| `moy.asr.waveform.settings.v1` | waveform | json | `browser / moy.asr.waveform.settings.v1` |
| `moy.asr.editor.customThemes.v1` | appearance | json | `browser / moy.asr.editor.customThemes.v1` |
| `moy.asr.editor.themeCustomColors.v1` | appearance | json | `browser / moy.asr.editor.themeCustomColors.v1` |
| `mawe.language` | language | text | `browser / mawe.language` |
| `msw.subtitle-proof.v1` | preview | json | `browser / msw.subtitle-proof.v1` |
| `msw.translation.call.v1` | processing | json | `browser / msw.translation.call.v1` |
| `maw.launcher.llm.prompts` | processing | json | `browser / maw.launcher.llm.prompts` |
| `maw.launcher.alignment.gap_remove` | processing | json | `browser / maw.launcher.alignment.gap_remove` |
| `msw.assets.columns` | editor | text | `browser / msw.assets.columns` |
| `msw.assets.showPlayer` | editor | text | `browser / msw.assets.showPlayer` |
| `msw.assets.showChanges` | editor | text | `browser / msw.assets.showChanges` |
| `msw.waveform.auto` | editor | text | `browser / msw.waveform.auto` |
| `moy.asr.editor.onboarding.v1` | onboarding | text | `browser / moy.asr.editor.onboarding.v1` |
| `moy.asr.editor.hideDisabledFlipped.v1` | migration | text | `browser / moy.asr.editor.hideDisabledFlipped.v1` |
| `moy.asr.editor.charcountMigrated.v1` | migration | text | `browser / moy.asr.editor.charcountMigrated.v1` |
| `moy.asr.gap_remove.advanced_open.v1` | panels | text | `browser / moy.asr.gap_remove.advanced_open.v1` |
| `moy.asr.gap_remove.disable_open.v1` | panels | text | `browser / moy.asr.gap_remove.disable_open.v1` |
| `msw.editor.settings.category.v1` | panels | text | `browser / msw.editor.settings.category.v1` |
| `moy.asr.gap_remove.panel.v1` | panels | json | `browser / moy.asr.gap_remove.panel.v1` |
| `moy.asr.help.panel.v1` | panels | json | `browser / moy.asr.help.panel.v1` |
| `moy.asr.help.panel.size.v1` | panels | json | `browser / moy.asr.help.panel.size.v1` |
| `moy.asr.auto_merge.panel.v2` | panels | json | `browser / moy.asr.auto_merge.panel.v2` |
| `moy.asr.subtitle_extend.panel.v1` | panels | json | `browser / moy.asr.subtitle_extend.panel.v1` |
| `moy.asr.editor.editorSettingsPanel.pos.v1` | panels | json | `browser / moy.asr.editor.editorSettingsPanel.pos.v1` |
| `moy.asr.ass_style.window.v1` | panels | json | `browser / moy.asr.ass_style.window.v1` |
| `moy.asr.editor.mediaSettingsPanel.pos.v1` | panels | json | `browser / moy.asr.editor.mediaSettingsPanel.pos.v1` |
| `moy.asr.editor.waveSettingsPanel.pos.v1` | panels | json | `browser / moy.asr.editor.waveSettingsPanel.pos.v1` |
| `moy.asr.editor.subtitleScalePanel.pos.v2` | panels | json | `browser / moy.asr.editor.subtitleScalePanel.pos.v2` |
| `msw.subtitleCleanup.position.v1` | panels | json | `browser / msw.subtitleCleanup.position.v1` |
| `msw.cueEditorSettings.pos.v1` | panels | json | `browser / msw.cueEditorSettings.pos.v1` |
| `moy.asr.editor.cueListSettingsPanel.pos.v1` | panels | json | `browser / moy.asr.editor.cueListSettingsPanel.pos.v1` |
| `msw.translation.panel.position` | panels | json | `browser / msw.translation.panel.position` |
| `MSW_SETTINGS_TAB_V1` | launcher | text | `browser / MSW_SETTINGS_TAB_V1` |
| `MSW_LAUNCHER_PAGE` | launcher | text | `browser / MSW_LAUNCHER_PAGE` |
| `MSW_TOOLS_PAGE_TOOL_V1` | launcher | text | `browser / MSW_TOOLS_PAGE_TOOL_V1` |
| `MSW_LAUNCHER_LOG_CARD_V1` | launcher | text | `browser / MSW_LAUNCHER_LOG_CARD_V1` |
| `MSW_HOME_GROUPS_V2` | launcher | json | `browser / MSW_HOME_GROUPS_V2` |
| `msw.subtitle-presets.v1` | subtitlePresets | json | `subtitlePresets / presets` |
| `moy.asr.ass.styles.v1` | assStyles | json | `assStyles` |
| `MAW_GUI_LAST_MODEL` | launcher | text | `launcher / MAW_GUI_LAST_MODEL` |
| `MAW_GUI_LAST_LANGUAGE` | launcher | text | `launcher / MAW_GUI_LAST_LANGUAGE` |
| `MAW_GUI_ZOOM_PERCENT` | launcher | text | `launcher / MAW_GUI_ZOOM_PERCENT` |
| `MAW_GUI_THEME` | launcher | text | `launcher / MAW_GUI_THEME` |

## 迁移的启动器环境字段

`MAW_GUI_ASR_SEGMENTATION`, `MAW_GUI_ATTACH_MODEL_NAME`, `MAW_GUI_LANG`, `MAW_GUI_LAST_LANGUAGE`, `MAW_GUI_LAST_MODEL`, `MAW_GUI_NOTIFY_ON_COMPLETE`, `MAW_GUI_OUTPUT_SUBFOLDER`, `MAW_GUI_PER_VIDEO_SUBFOLDER`, `MAW_GUI_PREFAB_MODULES`, `MAW_GUI_SHOW_RARE_LANGS`, `MAW_GUI_THEME`, `MAW_GUI_ZOOM_PERCENT`。其 MSW 前缀别名映射到同一个字段。
