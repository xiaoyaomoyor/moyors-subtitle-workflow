# 素材库操作与任务记录调整

基线：`my-feature` / `f2e6fe2`，保留此前已验证但未提交的油库里 E 阶段改动（24 文件）。本轮不提交推送、不接入新 TTS 引擎、不调用真实云服务。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| R1 | 素材库设置菜单与右键入口 | 已修复 | 密度移入媒体设置子菜单、保留原偏好；模块右键提供同值五档菜单并在屏幕边缘翻转，Chromium 2 项通过 |
| R2 | 合成与导出记录折叠滚动 | 已修复 | 合成／三类导出使用 details + 280px 滚动区，保留收起和滚动位置，移除旧记录条数截断；Chromium 2 项通过 |
| R3 | 素材删除图标与引用保护 | 已修复 | 四图标卡片、确认取消／接受、全部引用贴片移除、单次撤销／重做、保存重开和后台去重通过；Chromium 3 项通过 |
| R4 | 外部音频导入 | 已修复 | WAV 直接校验、压缩音频由后台 FFmpeg 转换，限额与幂等；保留原文件，复用保存／贴片／导出。定向 Python 7 项、Chromium 1 项通过；补充排队 TTS 容量复核进入最终回归 |
| V1 | 整体回归、文档及便携产物 | 已修复 | Node 305 项；Python 1282 项运行通过（19 跳过）；最终 Chromium 53 项全部通过；Ruff、语法、LF／敏感信息扫描、diff 检查通过；blank-editor.html 已重建 |
| Q1 | 百炼三类 TTS 与 CPU/GPU | 仅说明 | 查阅百炼官方 API，区分云端能力与本编辑器当前接入范围 |
| Q2 | 未来本地 TTS 资源架构 | 仅说明 | 说明可选独立运行环境／模型资源与设备能力，不新增引擎 |
| Q3 | 读音修正入口 | 仅说明 | 油库里下仅最终操作对象为一条字幕时显示；连锁字幕需先选主／副 |

验证使用隔离配置、本机测试服务器与合成文本，不读取真实 `.env`，不重启用户当前编辑器。

R1–R2 小结：设置菜单、右键设置与记录折叠已通过真实浏览器。导出窗口克隆器最初仍按旧 section 寻找记录容器，测试发现入口禁用；改为按记录区域 ID 查找后复验通过。未将失败归因于测试时序。

R3 决定：工程增加 `removed_asset_ids`，轮询不重新接收该 ID。独立的素材撤销记录只恢复该素材及其贴片，不覆盖后来生成的素材；普通字幕撤销保留当前素材库存和删除决定。磁盘音频保留给撤销、保存历史和既有导出快照；另存／打包只收集当前库存。删除的素材不再占当前工程的生成额度。

R4 决定：支持 WAV、MP3、FLAC、M4A、AAC、OGG／Opus，每次最多 100 个、每文件 32 MiB，解码 WAV 同样有大小上限，超限拒绝而不保存截断内容。导入显示文件名，不擅自识别或虚构文本。无损坏原文件、无真实云请求。导入前和登记前在任务锁内核对在途 TTS 预留量，转换不持锁；停止按钮只停止后续文件。初次实现中的工具对象取值和大小常量导入错误已经修复，定向测试通过。

V1 首轮：Node 305 项通过。Python 1282 项运行后出现 1 个清理错误：新增的容量检查初始化任务数据库，旧 API 测试基类直接删除临时目录，没有等待既有的异步任务关闭完成；功能断言均通过。新测试夹具显式等待 `close_complete`，保留生产代码原有非阻塞关闭策略，再跑完整套件。视觉检查发现右键密度选项带勾后换行，继续缩短文案并复验。

V1 浏览器首轮 50/53 通过，失败为既有的贴片颜色读取、播放头高亮、字幕预览缩放。三项保持原断言定向复验全部通过，同时最后的右键菜单／导入布局通过（共 5 项）。颜色测试原先对跨刷新保留的节点读取 computed style 得到空值，改为同一浏览器任务内查询当前节点并先等待实际 CSS；另外两项尚未复现，不声称已定位根因。继续跑最终完整浏览器回归，保留首轮失败事实。

Q1 官方核对：百炼提供系统音色合成、声音设计（VD）、声音复刻（VC）。本编辑器当前仅 Flash／Instruct-Flash 及对应快照；声音描述不是自定义音色创建界面，VD／VC 尚未接入。云端 API 没有本机 CPU／GPU 设备切换参数。参考[非实时合成](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide)、[声音设计](https://help.aliyun.com/zh/model-studio/voice-design-user-guide)、[声音复刻](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)。

Q2 方案：未来本地引擎采用独立环境与可选模型资源、能力检测、独立进程／本机服务适配，主包只保留适配代码。CPU／GPU 选项取决于实际引擎和环境，不在本轮实现。Qwen 官方也将 Python 依赖与模型／Tokenizer 分开安装，见[官方仓库](https://github.com/QwenLM/Qwen3-TTS)。Q3 入口已在 EDITOR_YUKKURI.md 补充到具体条件与位置。

## 最终验证

- `node --check`：`web/editor.js`、`web/waveform.js`、`web/msw-tts.js`、`web/msw-project.js`、`web/msw-audio-export.js` 通过；Ruff 检查全部变更 Python 文件通过。
- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs`：305/305 通过。
- 现有虚拟环境经隔离包装器执行完整 `unittest` discovery（`tests/test_*.py`）：1282 项，`OK (skipped=19)`；真实 FFmpeg 格式转换与本机油库里用例启用，19 项为套件按环境跳过的用例。
- `node node_modules/@playwright/test/cli.js test tests/e2e/editor-yukkuri.spec.mjs tests/e2e/editor-tts.spec.mjs tests/e2e/editor-video-export.spec.mjs tests/e2e/editor-audio-export.spec.mjs tests/e2e/subtitle-preview-geometry.spec.mjs --project=chromium`：最终 53/53 通过，未启用自动重试。首轮三个失败及定向复验见上文，不把最终通过当成已定位另外两项偶发失败的根因。
- 已查看最新菜单／导入截图：勾选密度项单行，导入按钮紧邻工程打包，卡片四图标、时间轴贴片正常；截图仅在工作区外的验证目录保留。
- 以隔离配置运行 `.venv/Scripts/python.exe edit.py --blank` 重建便携 HTML；`git diff --check`、34 个变更／新增文本文件的 LF、BOM、凭证形态及个人路径扫描通过。
- 未调用真实百炼接口；VD／VC 与其他本地 TTS 为说明项，未新增实现或声称实测。未重启用户服务；要启用后端导入接口，保存工程后重新启动本机编辑器并刷新页面。本轮未提交推送。

当前没有待处理、进行中或阻塞的实施项。
