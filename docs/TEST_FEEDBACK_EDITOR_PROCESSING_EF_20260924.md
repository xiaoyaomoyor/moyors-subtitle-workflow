# 编辑器处理流程 E、F 验收记录（2026-09-24）

范围：`PLAN_EDITOR_PROCESSING_20260924.md` 的 E 文件菜单与 F 集成回归。保留当前 A–D 及启动器未提交改动；不提交、不推送。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| E1 保存反馈 | 已修复 | 删除菜单状态节点；正常保存不追加状态消息，真实素材／恢复问题弹警告，同一恢复故障去重。Chromium 5 项通过：普通成功、保存中新改动、失败、另存为、警告保留。 |
| E2 共享最近工程 | 已修复 | 复用启动器 9 项合并视图；读取／打开鉴权，打开只允许当前可信视图；菜单／焦点／成功保存刷新，同名目录提示、失效路径与离线禁用。设置写入加跨进程锁并合并最新打开时间；重定位图钉随新路径、移除保留别名防止旧路径复活。服务 67、索引 39、新增契约 3、双窗口 Chromium 2 项通过。 |
| F 集成回归与产物 | 已修复 | 全量 Node 434 项通过；Python 1902 项完成、24 项跳过、无失败；跨阶段 Chromium 111 个不同用例最终通过。便携编辑器重新生成并与完整源码构建相等，UTF-8／LF、语法和 diff 检查通过。 |

## 基线

- 已阅读 AGENTS、计划、C+D 记录、工作区状态及 editor.js / gui_web.py 实际差异。
- 发现旧 `status()` 保存后重新显示菜单文字；最近列表来自服务器启动时快照，打开验证也仅使用旧快照。
- 不使用真实媒体、凭证或计费服务；所有验证使用隔离数据目录和合成工程。

## 阶段验证

- E1：`editor-editing-save.spec.mjs --grep 'save toast|save-as uses|save diagnostics'`，5 项通过。未修改保存期间新编辑的脏状态规则。
- E2：`test_editor_recent_sync.py` 3 项、`test_local_editor_server.py` 67 项、`test_launcher_projects.py` 39 项通过。并发用例显式指定不同时间，避免 Windows 时钟同一 tick 造成不确定顺序。
- E2 浏览器：`editor-processing-ef.spec.mjs` 2 项通过；两个窗口共用实际 Python 索引，验证固定／移除／重新定位／成功打开及断连后菜单恢复。首次运行暴露测试未等待重载，修正生命周期后重跑通过。
- 启动器沿用首页／焦点刷新，增加请求序号避免迟到的旧列表覆盖新视图。

## F 最终验收

- `node --test tests/test_*.mjs`：434 通过。覆盖音量、颜色、主副绑定、候选应用及撤销等纯逻辑。
- `python -m unittest discover -s tests -p "test_*.py"`：1902 项，24 跳过，无失败；测试 FFmpeg 放入 PATH，不对 Python 全套测试设置会影响路径模拟的 FFMPEG_PATH。旧工程的音频引用、保存／恢复／另存为往返由 persistence/schema 契约覆盖。
- `test_editor_recent_sync.py` 与 `test_launcher_projects.py` 在补充重定位后取消固定逻辑后再次运行：3 + 39 项通过。
- Chromium 套件：`editor-processing-ab`、`editor-processing-cd`、`editor-processing-ef`、`editor-editing-save`、`editor-i18n-save`、`editor-persistence`、`editor-translation`、`editor-asr`、`launcher-home`，共 111 个不同用例最终通过。
  - 首轮 108 项：80 通过、27 ASR 因未显式设置测试 FFmpeg 跳过，1 个 C+D ASR 用例因媒体探测缺工具未就绪。浏览器进程显式指定合成测试使用的 FFmpeg／FFprobe 后，27 ASR 和跨边界用例全部通过。
  - 补跑 78 项：77 通过，新增首次保存测试的模拟响应缺少新工程 ID，补齐模拟服务器契约后该项单独重跑通过；这是测试夹具问题。
  - 新增批量最近工程操作顺序用例单独通过：两次写入依次完成后才请求刷新。
  - 新增磁盘往返用例通过：候选修改、主／副／素材库三个应用记录保存后，清除浏览器候选草稿再重开仍保留，并正确禁止重复应用。
  - 中英文菜单、960×700 英文候选面板、失联恢复、离线入口禁用通过；已查看紧凑布局截图，内容和操作均在窗口内。
- `python edit.py --blank` 已执行；与 `edit.build_blank_html()` 全文一致。修改的 JS／MJS 经 `node --check`，文本 UTF-8／LF 无 BOM，`git diff --check` 通过。
- 本机验证日志位于工作区之外的 `msw-checks`：`ef-node.log`、`ef-python-full.log`、`ef-browser-full.log`、`ef-browser-verified.log`。首次保存与批量操作重跑见对应独立 Playwright 结果。

## 边界与交付

- 24 项 Python 跳过涉及平台条件、可选运行时或测试资源，不计为通过；本轮没有调用计费云端服务、真实用户媒体或凭证。
- 双窗口测试使用真实 Chromium 与实际 Python 工程索引；原生文件选择窗口及云端响应由隔离测试替身覆盖，没有声称验证系统原生窗口或远端供应商可用性。
- 无待处理或阻塞项。保留此前全部未提交工作；本轮未提交、未推送、未发布。
