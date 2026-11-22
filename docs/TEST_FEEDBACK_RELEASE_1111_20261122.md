# MSW v1.11.1 实施与发布

基于 [v1.11.1 筛选报告](UPSTREAM_1111_ASSESSMENT_20261122.md) 和 MSW v1.11.0 发行提交。

| 项目 | 状态 | 验证 |
| --- | --- | --- |
| A　Windows 运行环境路径 | 已修复 | 运行环境、打包及媒体服务定向回归通过。 |
| A　运行环境子进程回收 | 已修复 | 用真实 Windows 子进程验证回调异常清理，定向用例覆盖关闭输出后的取消及 POSIX 组所有权。 |
| B　FCP 7 XML 媒体回链 | 已修复 | XML 结构、时间轴边界、路径及浏览器导出已测。剪辑软件实机回链尚待验证。 |
| C　启动器配置读取 | 已修复 | 隐藏的原生 WebView2 窗口连续两次读取已保存的主题并正常退出。 |
| 三平台回归与正式发布 | 已修复 | 三平台构建、五包完整性及公开附件核对通过，GitHub 已列为最新正式版。 |

## A　运行环境

采用上游的 Windows 私有目录校验和 POSIX 进程组回收，接入 MSW 的目录选择、媒体和打包入口。短名必须指向同一目录。默认路径无法短名化时，使用 `MSW-runtimes-<SID 哈希>` 下的独立运行环境。显式指定目录可用同一目录的短名，导入自检失败时给出 ASCII 目录提示。安装与最终状态沿用同一次解析结果，模型缓存和工程位置独立。 [路径修复](https://github.com/Moyf/moys-asr-workflow/pull/356) · [进程组实现](https://github.com/Moyf/moys-asr-workflow/pull/359)

`python -m unittest` 的运行环境、Launcher 工作流、波形和媒体任务、打包合计 209 项通过。新增验证覆盖显式旧目录、按用户分开、公共目录权限失败、真实 Windows 子进程和取消。两份子运行环境副本都加入路径模块，发布校验会检查成品中相应文件。

本机已确认使用中文应用数据路径时三套默认环境会解析到 ASCII 路径。用 ProgramData 下独立的临时子目录验证原生私有权限、写入合成清单、回读就绪状态及传递安装路径。目录链存在广泛写入权限的测试父目录被拒绝。真实 Qwen-ASR 全量安装及模型推理仍未验收。

## B　FCP 7 XML

在现有序列化器统一 Windows 盘符为 `d%3a` 形式，保留 UNC、POSIX 段名及输入 URI 的已有编码。每个定义型 `file` 节点输出时间码，引用型节点通过 ID 复用定义。贴图格式也用序列的整数时基，原生文字、去空隙边界和双语导出覆盖在回归中。 [上游 XML 契约](https://github.com/Moyf/moys-asr-workflow/pull/358)

`node --test` 全部 849 项通过，包括新文件定义契约。Chromium 的 FCP 7 XML、Launcher 与识别设置 24 项通过。本机未安装 Premiere 和 DaVinci Resolve。

## C　启动器配置读取

配置读取接受 WebView 通用桥接传入的参数。共享配置快照缺失时，启动时保留错误提示并避免用失败结果初始化迁移。隔离目录中的原生 WebView2 连续两次启动均读取同一份已保存主题，后台队列随窗口正常退出。新增 Python 用例验证桥接调用和持久化偏好回读。

`uv lock --check --offline`、启动器版本校验、macOS 图标校验均通过。已生成并审阅正式版发行说明。

## 正式版回归

完整 Python 回归 `python -m unittest discover -v -s tests -t . -p "test_*.py"` 运行 2,608 项，其中 2,579 项通过、29 项按条件跳过。Windows 的 POSIX 实机组测试交由 macOS、Linux 构建运行。

首轮标签指向 `8b30e55b2f6ed7cdef952f363f7e560611800f1d`。macOS、Linux 通过，Windows 的首组浏览器测试 73 项通过、1 项短按空格用例失败。浏览器追踪显示，按下命令完成到抬起命令开始相隔约 392 ms，超过产品的 350 ms 长按阈值。首轮候选未公开。 [初次发布工作流](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44997306552)

短按用例调整为在同一次浏览器任务中派发按下、读取播放状态、再派发抬起，仍核对按下时不播放、抬起后仅切换一次。长按和重复按键继续走实际键盘输入。空格套件 13 项通过，涉及短按的用例再连续通过 5 次。第二轮发布沿用同一份产品代码。

第二轮标签指向 `97445935795dcb9f6b886c6d2da453ccfd732712`。首轮候选标签保留在本机，三平台以复测后的候选重新构建。 [第二次发布工作流](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44998753471)

## 正式版发行结果

MSW v1.11.1 于北京时间 2026-11-22 16:40:07 公开，已核对为最新正式版。Windows 云端 Chromium 共 676 项通过。Linux 和 macOS 两边真实进程组用例均通过，验证父进程退出后回收持有管道且忽略 SIGTERM 的子进程。 [GitHub Release](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.11.1)

独立下载五个构建包，并核对 ZIP 里的前端以及子运行环境路径模块与发布提交一致。Windows 标准版及 lite 在本机通过打包编辑器和媒体入口测试。五个包的 SHA-256 与公开附件及发行说明一致。五个安装包和两个源码下载入口均返回 HTTP 200。

| 应用包 | SHA-256 |
| --- | --- |
| `MSW-Windows-x64-v1.11.1.zip` | `2aa80a39de100b2f01cc00ec0a34eb8f5c181a6bae4a6a32ba3551a1ed711451` |
| `MSW-lite-Windows-x64-v1.11.1.zip` | `95a89312872e0fef070b633e6a818ecdb962651868c9f39fddf63fcc311c9dc5` |
| `MSW-macOS-arm64-v1.11.1.zip` | `3565c8dccbb5a66ac3e647f4163dc8a6bce8763479c366dc841b9dac0f6b87aa` |
| `MSW-lite-macOS-arm64-v1.11.1.zip` | `0b781a961239bae5fbd082970873ee969a01ea440d0f26c7b6ceb85dd100ad3d` |
| `MSW-Linux-x86_64-v1.11.1.AppImage` | `1c8c5d82ae411fd7bb8c4041f45f850efdf0a6f936d06d70c6c67a75eac50774` |
