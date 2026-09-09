# 编辑器油库里 TTS

油库里是可选的本地配音引擎，在「媒体 → TTS → 引擎 → 油库里（本地）」使用。不需要百炼 API Key；安装资源后，合成不访问网络。

「合成设置」中的「试听音色」按当前音色、语言读法和语速生成一段固定短句，自动打开素材库底部播放器；试听结果仅临时播放，不新增素材或合成记录。语速在合成设置底部占满一行。需要保存实际字幕或草稿音频时点击「开始合成」。

## 资源在哪里获取

推荐在「编辑 → 全局设置 → 环境配置 → TTS」选择油库里，展开「油库里资源」，点击「安装资源包」。MSW 从下列公开来源下载固定版本并校验摘要：

- [aquestalk.js](https://github.com/y52en/aquestalk.js)：WASM 引擎及原始八音色 ZIP，使用 npm 发布的 1.0.7。
- [Node.js 官方发行版](https://nodejs.org/dist/v24.19.0/)：独立 Node 24.19.0 运行时，无需用户预先安装 Node 或 npm。
- [bakak2k 英文转换规则](https://github.com/Love-Kogasa/bakak2k/tree/fa8ff762e39eb0065801010d44ef5bc295d109da)：只获取独立英文规则和 MIT 许可，不需要日文词典。
- npm 上的 `tiny-pinyin`、`pinyin-to-kana`、`number-to-chinese-words` 及固定传递依赖：汉字读音与数字转换。

完整 URL、版本与摘要在 `maw/msw/yukkuri_resources.json`。安装过程不运行 npm 安装脚本，不修改系统 PATH。各平台资源分开，不能将 Windows 的资源包用于 macOS／Linux。

离线使用：在有网络的同平台电脑安装一次，将资源目录复制给离线电脑；也可以在源码环境生成单独 ZIP：

```powershell
uv run python -m maw.msw.yukkuri_runtime install ./yukkuri-resources
# 上一条命令末尾显示实际资源目录，将它填入下面的 <资源目录>。
uv run python -m maw.msw.yukkuri_runtime pack "<资源目录>" --output ./msw-yukkuri-resources.zip
```

解压 ZIP，在全局环境配置的「资源目录」中填写**包含 `msw-runtime.json` 的目录**，点击「应用目录并检测」。检测通过后才替换当前配置。ZIP 是 MSW 资源布局；单独下载指定参考项目的 `dist.js` 或 AquesTalk DLL 不等于完整资源包。目前没有承诺已发布的 MSW GitHub Release 资源附件；程序内安装与上述命令是可用的获取方式。

下载／校验／试合成均为后台操作，可以取消。失败时不会替换之前可用的资源配置；已校验的下载缓存供下次使用。安装路径位于 MSW 应用数据目录下的 `yukkuri`，也可使用用户指定的离线目录。失败尝试目录及旧版本保留，确认无任务使用后可手动移除；不要删除当前启用的目录。

## 文字与音色

- 支持中文、英文和混合文本，八种音色为 `f1`、`f2`、`m1`、`m2`、`dvd`、`imd1`、`jgr`、`r1`。这些是引擎的音色 ID，不强行对应某个角色。
- 语速为 50–300，默认 100。
- 语言选择影响数字读法：中文按中文数词，英文逐位读数字；自动模式在含汉字时使用中文数字读法，否则使用英文。中英文正文在三个选项下均可混合。
- 油库里通过日文假名近似中文／英文发音，不是自然英语 TTS。英文优先匹配规则词表，再按发音规则推导；多音字及专有名词可能需要修正。
- 选中一条字幕，在「媒体 → TTS」将引擎切到「油库里（本地）」；若字幕连锁，先选主／副对象。最终只处理一条字幕时，「语速」下方显示「读音修正」，可填同音汉字、英文或假名。修正只影响此次配音，不改字幕原文。百炼或多条合成模式不显示此输入框。
- 每条最多 600 字符；内部按读音分段调用引擎，再拼接完整 PCM WAV。不会裁到字幕时长。无法转换的字符会报告该条失败；没有自动丢弃整句或改用云端服务。

## 素材、保存与导出

选区规则与百炼相同：有选区则处理选区；连锁字幕执行前选择主／副字幕；独立字幕保留原选区。无选区且有双轨时先选轨。每条完成后进入素材库并自动展开。

引擎输出 8 kHz、16-bit、单声道 PCM WAV。试听、放置贴片、静音、音量、热力图、工程素材收集，以及 WAV、视频和剪辑工程导出均沿用现有音频处理链。WAV 已保存后，重新打开工程与导出不依赖油库里运行时。

工程素材记录原文 `display_text`、实际传给引擎的假名 `spoken_text`、可选来源 `pronunciation_override`，以及引擎／资源／转换器版本、音色、语速和语言。运行时绝对路径与当前引擎偏好仅保存到本机 `yukkuri/settings.json`；API Key 不进入油库里配置或工程。

## 来源与许可

实现参考 [zh-yukkuri.js](https://github.com/Love-Kogasa/zh-yukkuri.js) 的中文转读音路径，MSW 独立编写转换适配器，不分发该包装项目的代码。MIT 依赖及英文规则保留各自许可。资源包保留 AquesTalk 原始 ZIP 和其中的 `AqLicence.txt`，不改 DLL；Node 也带官方 LICENSE。

语音合成使用 AquesTalk，版权归株式会社アクエスト。AquesTalk 原生资源适用其随包许可，与外围 JavaScript 的 MIT 许可不同；用途请对照实际资源中的许可及 [AquesTalk 官方许可说明](https://www.a-quest.com/licence.html)。
