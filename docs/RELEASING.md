# 构建与发布 MSW

当前目标为 MSW `1.6.0-beta.1`，基于 MAW 同版本。仓库和标签相互独立；MSW 的 `v1.6.0-beta.1` 应指向 `my-feature` 上经过验证的提交，不能指向用于跟踪上游的 `main`。

## 发布清单

目标附件为[安装页](INSTALLATION.md)列出的五种应用包，加 GitHub 自动生成的两项 Source code，总计七项。不要用源码 ZIP 代替应用包，不把模型、Key 或可选运行时资源塞进主包。校验和写入发行说明，不额外增加附件数量。

- Windows x64：标准版、lite，原生 Windows runner 构建。
- macOS arm64：标准版、lite，Apple Silicon runner 构建；ad-hoc 签名，尚无 Apple 公证。
- Linux x86_64：内含 FFmpeg 的 AppImage，Ubuntu 22.04 runner 构建。

## 构建预演

在仓库 Actions 中选择 **Release MSW GUI → Run workflow → my-feature**。手动运行会按 `pyproject.toml` 中的版本生成正式命名的候选包，并运行五包完整性检查；不会创建 tag 或 GitHub Release。最终 `release-preflight` artifact 含发行说明预览与各包 SHA-256。

工作流为 `.github/workflows/release.yml`，复用 `MSW.spec`、`scripts/build-windows.ps1`、`scripts/build-appimage.sh` 和 macOS 原生步骤。三个构建平台全部成功才能进入总校验；任一失败都会阻止公开发布，不再降级为只发布 Windows。

校验包括：锁定依赖与版本、Python 回归、Windows 上的 JS／Chromium 回归、实际打包程序导入与启动、图标／帮助／油库里接入脚本、standard / lite 的 FFmpeg 差异、ZIP CRC 和 AppImage 标识。打包程序 `--smoke-import` 真正导入关键模块，不再立即返回成功。

## 本机准备

```sh
uv sync --group build --frozen
python scripts/sync_launcher_version.py --check
python scripts/build_macos_icon.py --check
uv run python edit.py --blank
uv run python -m unittest discover -s tests -p "test_*.py"
node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs
git diff --check
```

Windows 可执行 `scripts/build-windows.ps1`；该脚本需要工作流中列出的 Python bootstrap 缓存，并准备可选运行时依赖清单。需要最终标准／lite ZIP 时优先使用完整 Actions 流程；不要把一次本机 PyInstaller 冒烟结果标成三个平台都可发布。

GUI 分发资源采用明确清单；不携带仓库历史截图、开发反馈记录、测试、`.env`、用户配置、缓存或权重。入口服务只收集运行所需文件，避免把测试生成的 `__pycache__` 带入包。随包提供 `README-开始使用.txt`、FAQ 与许可。

## 发布前最后一步

1. 核对候选包的提交 SHA；分别在目标平台启动 Launcher、打开 Server 编辑器、加载工程并保存，至少完成一次对应环境可用的配音与导出。CI 的启动检查不能代替真实用户环境验收。
2. 检查 `CHANGELOG.md` 的 MSW 版本条目。旧上游版本说明和开发明细放在 `archived/`，避免发行说明只列上游更新而漏掉 MSW 配音功能。
3. 运行 `python scripts/prepare_release_notes.py --tag v1.6.0-beta.1 --output <临时目录>/release-notes.md`，审阅实际正文。文档链接固定到该标签，预发布版本不会自动成为 GitHub 的 latest 正式版。
4. 维护者确认公开发布后，在已验证的 `my-feature` 提交上创建并推送 `v1.6.0-beta.1` 标签。标签 push 会重新构建并验证五个包，随后创建标记为 prerelease 的 GitHub Release。
5. 若同名 Release 已有附件，先核查附件来源与状态；失败运行不能视为发布完成。完成后复查七项下载、版本、SHA-256 与文档链接。

本文件是发布流程，不代表本轮已建立远端标签或已经发布。当前验证证据见 [发布准备账本](TEST_FEEDBACK_RELEASE_PREP.md)。
