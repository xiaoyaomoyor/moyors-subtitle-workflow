# MSW v1.11.0 C 阶段与发布

基于 [A、B 阶段回归](TEST_FEEDBACK_UPSTREAM_1110_AB_20261121.md) 和[筛选报告](UPSTREAM_1110_ASSESSMENT_20261121.md)，补齐旧式双语的暂停预览并发布正式版。

| 项目 | 状态 | 验证 |
| --- | --- | --- |
| 旧式双语暂停预览 | 已修复 | 真实浏览器中关闭、撤销、重做及重新开启会立即刷新副字幕，媒体停在原时间。 |
| Windows 自动保存期间提交识别 | 已修复 | 媒体及识别验证当前工程绑定，保存流程继续核对磁盘版本。独占锁与浏览器复测通过。 |
| v1.11.0 回归与正式发布 | 已修复 | 三平台构建、五包总校验及上传通过，GitHub 已列为最新正式版。 |

## 本机回归

- `playwright test tests/e2e/playback-refresh.spec.mjs` 4 项通过。新增用例修复前在关闭和重做时复现副字幕残留，修复后通过，同时确认主字幕及暂停位置。
- Chromium 另通过 82 项去空隙试听、长按空格、字体缺字、启动器队列及识别设置与编辑器识别回归。
- `node --test` 运行 `tests/test_*.mjs` 全部 849 项通过。编辑器、波形、音频调度与字体选择器均通过 `node --check`。
- `python -m unittest discover -v -s tests -t . -p "test_*.py"` 最终候选运行 2,599 项，2,571 项通过、28 项条件跳过。
- `uv lock --check --offline`、版本同步和 macOS 图标检查通过。已生成并审阅 v1.11.0 发行说明及五包下载名称。
- 以隔离设置启动本机 Windows 原生 WebView2 窗口。启动器初始化和后台消息队列正常启动，投递合成消息后关闭原生窗口，确认事件队列清空并停止。加载时记录到 `get_user_config` 的参数错误，v1.10.0 源码已有相同的调用和签名，启动器仍完成初始化。本轮修复覆盖窗口退出。
- Soniox v6 以模拟服务验证模型与解析契约。

## 发布流程

首轮标签指向 `0c07989dd7b37f2e40fe3e9206e6cd89be38e492`。Windows 的识别、配音、启动器回归组中 151 项通过，OpenAI 模拟识别在自动保存重叠时收到 HTTP 403。浏览器诊断确认识别提交时自动保存仍在运行。首轮候选未公开。 [首轮发布工作流](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44881943189)

识别和媒体请求检查绑定时省去工程文件哈希。新增测试在读取被拒绝时验证有效绑定能继续、旧绑定仍会被拒绝，并用真实 Windows 独占锁复核。Python 的持久化、媒体服务、ASR 及处理接口共 80 项通过。Chromium 中 Qwen、Soniox v6/v5 和 OpenAI 模拟提交连续两轮共 8 项通过。

第二轮标签指向 `f4c06974826ad8cc47d6068fb7f73c99878edc7b`。首轮标签对象保留在本机，三个平台从修复提交重新构建。 [第二轮发布工作流](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44885150921)

## 正式版发行结果

MSW v1.11.0 于北京时间 2026-11-21 17:26:12 公开，为 GitHub 最新正式版。Windows 云端 Chromium 共 676 项通过。 [GitHub Release](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.11.0)

独立下载并校验三个平台的五个构建包。四个 ZIP 的前端源码和托管运行环境清单与候选构建一致。Windows 标准版与 lite 均在本机通过打包编辑器与媒体入口测试。五包 SHA-256 与公开附件、发行说明和发布检查记录一致。五个安装包和两个源码下载入口均返回 HTTP 200。

| 应用包 | SHA-256 |
| --- | --- |
| `MSW-Windows-x64-v1.11.0.zip` | `073fcc9c52c504198945ed0fbd0a585b9dc2ca76a934de9e14c34eed0b548156` |
| `MSW-lite-Windows-x64-v1.11.0.zip` | `a22b364d0785d2815e98e4cb24b38523e7df27c7e78c98e629a7dd6266599cbe` |
| `MSW-macOS-arm64-v1.11.0.zip` | `d156f012c60db9f07be9f397c31663fb085d690322ec01823d6a3097506e29ce` |
| `MSW-lite-macOS-arm64-v1.11.0.zip` | `dd3f465a146c2ee4d6c67667b602027935cff38de59e3c94e99493ea75819a0d` |
| `MSW-Linux-x86_64-v1.11.0.AppImage` | `5923a65438442fe9aab0315afa86a493f4159f3a3705530d29417c5371c46a7f` |
