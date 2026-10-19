# 启动页与旧样式清理（2026-10-19）

- 基线 b24634a5，my-feature；保留已有 debug.log、.test-appdata/、output/。不改写个人工程，不调用云端。
- 本轮移除旧预览／ASS 方案的自动预设迁移，修复工程卡片操作，精简首页和服务器控制。删除工程测试只使用隔离夹具。

| 项目 | 状态 | 决策与验证 |
| --- | --- | --- |
| 重新定位／删除工程失效 | 已修复 | 修正原生对话框筛选语法和误用 self.sessions；3 项 Python 桥接专项通过，覆盖取消与正在使用的工程。Windows 真实回收站验证通过，仅删除隔离夹具，相邻文件保留。重新定位后保留选中与启动目标，删除／Ctrl 取消最后一张卡片后清空目标。 |
| 图钉与 NEW 标记 | 已修复 | 实心图钉与 NEW 使用一致底色、边框、24px 高度；浅深主题截图验证。 |
| 首页布局、服务器控制与气泡 | 已修复 | 34 项首页浏览器用例通过（含失败修正后重跑）；移除高级区、目标提示和页顶状态；搜索旁文件夹，页脚服务器状态／端口，右侧启动操作，页顶仅 GitHub 图标。 |
| 移除旧样式迁移预设 | 已修复 | Node 样式 12 项通过；不再生成或列出旧工程预览样式和 ASS 输出方案；旧工程数据仍可打开。 |
| 验证与运行加载 | 已修复 | Python 324 通过／1 平台跳过，Node 353 通过，浏览器 98 项分批通过；产物已生成、UTF-8／LF 与差异检查通过；本机启动器与 8250 服务已重启，健康接口返回 ready，原生窗口已显示新版首页。 |

- 首次 Python 专项因沙箱临时目录写入限制失败，改用工作区 TEMP 后通过；首次浏览器运行因沙箱找不到已安装 Chromium，改用授权运行。首页第一轮发现已移除按钮残留监听，修正后首页加载验证通过；完整回归中旧用例尝试点击现在已禁用的启动按钮，已改验防重复提交。
- Python 全专项首轮还发现 13 项旧界面契约不再适用、2 项回环 HTTP 探测受沙箱阻止；契约同步为新界面后，授权运行 325 项成功，其中非 Windows 打开方式测试在 Windows 跳过。
- 浏览器新增重新定位成功用例发现：在列表刷新前同步新路径会清空选中；调整为先刷新列表再同步目标。删除后清空目标也已覆盖。右键测试的自动滚动会关闭菜单，等待滚动完成后重跑删除／重新定位／Ctrl 取消 3 项全部通过。

验证命令与边界：

- `.venv/Scripts/python.exe -m unittest tests.test_gui_web tests.test_launcher_projects tests.test_project_subtitle_style`：325 项，324 通过、1 平台跳过。
- `node --test tests/test_project_style.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs`：353 项通过。
- `npx playwright test` 指定 `launcher-home`、`launcher-structure`、`launcher-shell`、`launcher-queue`、`launcher-interactions`、`project-subtitle-style`，Chromium：98 个不同用例通过，分批及修正重跑；包括浅深主题、窄窗、服务器启停、预制流程，以及字幕预览／ASS／FFmpeg 烧录。
- `uv run --frozen --no-sync python edit.py --blank`、`git diff --check`、UTF-8／LF 检查通过。
- 原生重新定位验证使用真实 pywebview 筛选器解析加模拟文件选择结果；未自动点击操作系统文件对话框。真实 Windows 回收站验证使用隔离测试工程，不修改用户工程。
- 不调用云端识别、翻译或配音。没有执行仓库全量 Python／浏览器套件，以上结果仅对应本轮专项。
