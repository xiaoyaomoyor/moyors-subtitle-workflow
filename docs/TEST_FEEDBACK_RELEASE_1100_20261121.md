# MSW v1.10.0 正式版

以通过三平台五包预演的 MSW beta.2 候选为基础，按[正式版筛选](UPSTREAM_1100_STABLE_ASSESSMENT_20261121.md)修复本地 ASR 自定义模型目录。

| 项目 | 状态 | 验证 |
| --- | --- | --- |
| 目录、快照与识别入参 | 已修复 | 模型目录、双缓存、权重分片、偏好和共享识别入参共 44 项专项测试通过。 |
| 启动器选目录与编辑器反馈 | 已修复 | Chromium 3 项通过，覆盖延迟回调、取消、切换、重开、恢复自动检测及目录错误反馈。 |
| 正式版元数据、说明与回归 | 已修复 | 核对版本标记、锁文件、发行说明与 macOS 图标。Node 847 项通过，Python 2,564 项通过、28 项条件跳过。 |
| 三平台五包与公开发布 | 已修复 | 第二轮三平台构建和五包总校验通过，v1.10.0 已公开为最新正式版。 |

验证使用合成目录和模拟运行环境，真实模型下载和推理仍有实机验证边界。快速测试的波形预计算和 PR 预览包按筛选结论留待专项评估。

首次候选为 `06474c20f990300f9ffe2338a60526b49229b43b`。[首次 GitHub 发布工作流](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44864614705) 的 Windows 英文界面测试发现编辑器「留空时自动检测」占位提示漏译。同组其余 35 项通过，GitHub 尚未创建该版本 Release。已补齐英文词条，在通过本机复测后重新构建。

本机完整 Python 回归使用 `PYTHONUTF8=1`，让父进程和子进程均按 UTF-8 读写。初次运行中六个 CLI 测试因本机 GBK 解码子进程的 UTF-8 输出而失败，统一编码后通过。

英文占位提示修正后，单条复测通过。再运行英文界面、真实视频导出、模型目录、识别设置和启动器模型共 77 项 Chromium 测试，全部通过。发布标签更新到 `e68eea539229d9285f6c11386a7ba9061723b399`，保留首轮标签对象。仅使用[第二轮发布工作流](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44866795990)的构建产物。

## 正式版发行结果

MSW v1.10.0 于北京时间 2026-11-21 13:40:54 公开。第二轮三平台构建、五包总校验及上传均通过，Windows 云端 Chromium 回归共 672 项通过。GitHub 已将 v1.10.0 列为最新正式版。 [GitHub Release](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.10.0)

独立下载五个构建产物，核对 ZIP／AppImage 完整性、包内前端源码与托管环境依赖清单。五包 SHA-256 与 GitHub 公开附件、发行说明及预演记录逐项一致，两个自动生成的源码下载入口均可访问。Windows 标准版与 lite 包在本机隔离目录通过冻结编辑器与媒体入口冒烟测试。

| 应用包 | SHA-256 |
| --- | --- |
| `MSW-Windows-x64-v1.10.0.zip` | `59901a1a32d8adfff9fcfd82b25b971049e144f0ca24d3564f1ef402b43dda4e` |
| `MSW-lite-Windows-x64-v1.10.0.zip` | `495418715163c8ebbf3b4642e085c0c3470350c3806b84150b3bdae7da992dad` |
| `MSW-macOS-arm64-v1.10.0.zip` | `98e2188b7a5781f8221d817ad36f46bb6c177789e4a0d90db18fea5170721b9b` |
| `MSW-lite-macOS-arm64-v1.10.0.zip` | `811f9100ae49a5b216725ae1088d299ca75c048bb8f5ce98c9a46e057b230021` |
| `MSW-Linux-x86_64-v1.10.0.AppImage` | `1cad77c180bd3bcbd4a9eed5c9b376a3f0f3a2ef7c92b3488ca85489194c6cc9` |
