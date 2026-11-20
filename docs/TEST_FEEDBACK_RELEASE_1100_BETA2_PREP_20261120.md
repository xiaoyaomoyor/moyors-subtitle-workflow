# MSW v1.10.0-beta.2 发布准备

候选基线为 `6a45a430`。四组建议已落实在 `efe37208`，详见 [实施验证记录](TEST_FEEDBACK_RELEASE_1100_BETA2_20261120.md)。本轮准备分支候选和五包预演。

| 项目 | 状态 | 验证范围 |
| --- | --- | --- |
| 四组适配 | 已修复 | 安全依赖、播放与工具、查找并编辑、字体兼容。 |
| 候选版本与发行说明 | 已修复 | 元数据、本机编辑器、Launcher、使用文档和说明脚本。 |
| 三平台构建与产物 | 进行中 | Windows、macOS、Linux，五个包及 SHA-256。 |

beta.1 先前通过分支预演。beta.2 候选说明一起列出用户从 v1.9.0 升级时可见的对齐管理、后处理连接与 Windows FFmpeg 查找改进。

启动器、本机编辑器、快速开始、Python 元数据和依赖锁已同步到 1.10.0-beta.2。生成并审查正式发行说明。GitHub 核对显示 v1.9.0 为 latest，两个 1.10 预览标签与 Release 均未创建。Windows 预演纳入查找并编辑、路径联动、拆分和 ASS 预览回归。

本机首轮补测把历史点击行为文件整份加入，触及三个本版无关的既有用例。两个旧自动滚动用例引用已移除的选择器，最近工程删除用例也未通过。候选额外覆盖限定在本次的 B 键波形和列表切点反馈，现有发布回归继续执行。首轮分支预演 44731128985 停止，按更新后的验证范围重新启动。


## 暂停检查点

原生候选构建对应 `639064e86f3c85b20cf5f69376eee616547c88b2`。[Actions 预演 44731827762](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44731827762) 第 1 次尝试。已同步版本并生成候选发行说明。本机回归为 Python 2,563 通过、23 条件跳过，Node 847 通过，新增发布浏览器检查 31 通过。三个旧点击用例在隔离的 beta.1 基线也出现相同失败。

- Linux 构建和冻结入口通过，已下载并复核 `MSW-Linux-x86_64-v1.10.0-beta.2.AppImage`。SHA-256 为 `4633eeb8ae283dd14924a470e0bfc2fda844b6ec8111f5fac36e640acdb80384`。
- Windows 状态为 `in_progress`。最后一次读取时的步骤为 `Check flat editing, properties and project persistence in Chromium`。候选 Windows 两种安装包已通过云端冻结入口和本版新增浏览器检查，整套浏览器回归继续运行。
- macOS 任务 `136273341980` 因 GitHub 未能分配托管 arm64 构建资源而取消。Windows 等任务执行期间，GitHub 返回 403 拒绝单独重跑。暂停时已结束本地监控及待触发的重试，GitHub 已开始的 Windows 任务继续执行。

恢复时从上述 Actions 预演读取最新状态。Windows、Linux 成功后，在同一预演上重跑 macOS，并完成五包、发行说明和校验和比对。当前仍处于发布准备阶段。
