#!/usr/bin/env bash
# 构建 MSW Linux AppImage。产物：build-appimage/MSW-Linux-x86_64.AppImage
# 前置：系统需有 ffmpeg（生成图标）与 mksquashfs（appimagetool 内部使用）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BUILD_DIR="$REPO_ROOT/build-appimage"
APP_DIR="$BUILD_DIR/MSW.AppDir"
APPIMAGE_TOOL="$BUILD_DIR/appimagetool-x86_64.AppImage"
APPIMAGE_URL="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
mkdir -p "$BUILD_DIR"

echo "==> 1/6 PyInstaller 构建 dist/MSW"
# 生成托管 Runtime 的 frozen requirements txt（MSW.spec datas 条件追加打包）；
# 主清单与 CPU 变体统一由 freezer 模块执行（与 build-windows.ps1 /
# release.yml / 源码模式自动补齐完全同源）。
mkdir -p build
uv run python -m maw.runtimes.freezer freeze --force
uv run --group build pyinstaller --noconfirm --clean MSW.spec
# PyInstaller 6 places datas under _internal in an onedir bundle. Keep the
# user-facing FAQ at the AppImage root as well, where users can find it easily.
cp "FAQ-常见问题.txt" "dist/MSW/FAQ-常见问题.txt"
cp README-开始使用.txt LICENSE THIRD_PARTY_NOTICES.md dist/MSW/

echo "==> 2/6 准备静态 ffmpeg（BtbN FFmpeg-Builds，固定月末 8.1 构建）"
FFMPEG_VERSION="n8.1.2-50-g1a748fe2cd"
FFMPEG_TARBALL="$BUILD_DIR/ffmpeg-${FFMPEG_VERSION}-linux64-gpl-8.1.tar.xz"
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-${FFMPEG_VERSION}-linux64-gpl-8.1.tar.xz"
FFMPEG_SHA256="c733b4b2951e5957e15505f788b2c65a7a41b6da4b289e295852cc38079b4d2b"
FFMPEG_DIR="$BUILD_DIR/ffmpeg-static-$FFMPEG_VERSION"
# 静态版自包含 libstdc++ 依赖，不受 PyInstaller 的 _internal 旧库污染；
# 动态版 ffmpeg 若打进包内，AppRun 污染环境下照样会 GLIBCXX 报错。
# BtbN 仅保留最近 14 个每日构建，月末构建保留两年；固定月末版本与 SHA256，
# 到期前需重新审查可用归档。8.1 稳定分支保留现有混音导出的参数兼容性。
# 升级时同时核对版本、URL、归档名和 SHA256；缓存目录随版本隔离。
# checksums: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27
if [ ! -x "$FFMPEG_DIR/bin/ffmpeg" ]; then
    if [ ! -f "$FFMPEG_TARBALL" ]; then
        echo "    下载静态 ffmpeg..."
        curl --fail --location --silent --show-error --retry 3 --retry-all-errors \
            --retry-delay 2 --connect-timeout 20 --max-time 300 -o "$FFMPEG_TARBALL" "$FFMPEG_URL"
    fi
    echo "    校验静态 ffmpeg 完整性..."
    if ! echo "$FFMPEG_SHA256  $FFMPEG_TARBALL" | sha256sum -c - >/dev/null; then
        echo "错误：ffmpeg 下载校验和不匹配（$FFMPEG_TARBALL），已删除请重试。" >&2
        rm -f "$FFMPEG_TARBALL"
        exit 1
    fi
    mkdir -p "$FFMPEG_DIR"
    tar -xf "$FFMPEG_TARBALL" -C "$FFMPEG_DIR" --strip-components=1
    chmod +x "$FFMPEG_DIR/bin/ffmpeg" "$FFMPEG_DIR/bin/ffprobe"
fi
# 放入 PyInstaller onedir 产物：frozen 时 _bundled_ffmpeg_directory() 查
# sys.executable.parent / ffmpeg / bin（即 dist/MSW/ffmpeg/bin）。BtbN 包内
# 二进制位于解压根目录的 bin/ 子目录（与 johnvansickle 的根目录布局不同）。
mkdir -p "dist/MSW/ffmpeg/bin"
cp "$FFMPEG_DIR/bin/ffmpeg" "$FFMPEG_DIR/bin/ffprobe" "dist/MSW/ffmpeg/bin/"
# GPL 合规：BtbN linux64-gpl 是 GPL 构建，分发须随附许可证文本与对应源码
# 获取方式（GPLv3 §4 传递许可证副本、§6 提供源码书面要约）。GPLv3 全文
# 优先从 gnu.org 拉取，失败时回退 GitHub 官方 SPDX 镜像（GitHub hosted
# runner 上 gnu.org 偶发连接超时，curl (28) 会导致 AppImage 构建连带失败）；
# SOURCE.txt 记录构建来源、归档地址与校验和。
_GPL_TARGET="dist/MSW/ffmpeg/GPLv3.txt"
_GPL_TMP="${_GPL_TARGET}.tmp"
rm -f "$_GPL_TMP"
if curl --fail --location --silent --show-error --connect-timeout 15 --max-time 90 \
    -o "$_GPL_TMP" "https://www.gnu.org/licenses/gpl-3.0.txt" \
    || curl --fail --location --silent --show-error --connect-timeout 15 --max-time 90 --retry 1 \
        -o "$_GPL_TMP" \
        "https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-only.txt"; then
    :
else
    rm -f "$_GPL_TMP"
    echo "GPL 许可证文本下载失败（gnu.org 与 SPDX 镜像均不可达）" >&2
    exit 1
fi
grep -q "GNU GENERAL" "$_GPL_TMP" || { rm -f "$_GPL_TMP"; echo "GPL 许可证文本内容校验失败" >&2; exit 1; }
mv -f "$_GPL_TMP" "$_GPL_TARGET"
test -s "$_GPL_TARGET"
cat > "dist/MSW/ffmpeg/SOURCE.txt" <<EOF
FFmpeg $FFMPEG_VERSION — BtbN FFmpeg-Builds linux64-gpl static build
Build provider: https://github.com/BtbN/FFmpeg-Builds
Original archive: $FFMPEG_URL
Archive SHA-256: $FFMPEG_SHA256
License: GPL-3.0 (full text in GPLv3.txt)
Upstream FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/1a748fe2cd
This MSW package includes only ffmpeg and ffprobe from the original build.
EOF
echo "    静态 ffmpeg: $("$FFMPEG_DIR/bin/ffmpeg" -version 2>&1 | head -n 1)"

echo "==> 3/6 组装 AppDir"
if [ -d "$APP_DIR" ]; then
    rm -r "$APP_DIR"
fi
mkdir -p "$APP_DIR"
cp -a dist/MSW/. "$APP_DIR/"

# PyInstaller 会把构建机（ubuntu-22.04，GCC 11）的 libstdc++/libgcc_s 收进
# _internal。在系统 libstdc++ 更新的发行版（如 SteamOS 的 GCC 14）上，这两把
# 旧库会抢先于系统库被加载，导致系统 Mesa 驱动链（radeonsi → libLLVM →
# libstdc++）与 libSPIRV-Tools 因缺 GLIBCXX_3.4.32 加载失败，QtWebEngine
# 无可用渲染后端而 abort。libstdc++ ABI 向后兼容，直接剔除、使用系统版本；
# 后续如需支持系统库过老的发行版，再引入 compat 目录按需加载。
# 同理剔除 libgbm.so.1：libQt6WebEngineCore（Chromium GPU 进程）直接链接它，
# 包内的是构建机 Mesa 22 旧版，会抢先于系统 gbm（SteamOS Mesa 24+）被加载；
# 系统 libgbm 导出符号是旧版的超集（Chromium 所需 20 个 gbm_* 符号全覆盖），
# 剔除后由系统版本接管，行为正确。
rm -f "$APP_DIR/_internal/libstdc++.so.6" "$APP_DIR/_internal/libgcc_s.so.1" \
      "$APP_DIR/_internal/libgbm.so.1" "$APP_DIR"/_internal/libreadline.so.*

# AppRun：QtWebEngine 在 AppImage（squashfs 只读、无 SUID sandbox helper）环境
# 必须禁用 Chromium 沙箱，否则 Launcher 页面无法渲染。
cat > "$APP_DIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(CDPATH= cd -- "$(dirname -- "$(readlink -f "$0")")" && pwd)"
export QTWEBENGINE_DISABLE_SANDBOX=1
export QTWEBENGINE_CHROMIUM_FLAGS="${QTWEBENGINE_CHROMIUM_FLAGS:+$QTWEBENGINE_CHROMIUM_FLAGS }--no-sandbox"
exec "$HERE/MSW" "$@"
EOF
chmod +x "$APP_DIR/AppRun"

cat > "$APP_DIR/MSW.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=MSW
Name[zh_CN]=MSW
Comment=Moy's ASR Workflow - subtitle transcription and editing
Comment[zh_CN]=Moy 的 ASR 工作流 - 字幕转写与编辑
Exec=MSW
Icon=MSW
Terminal=false
Categories=AudioVideo;AudioVideoEditing;
StartupWMClass=MSW
EOF

ffmpeg -y -loglevel error -i assets/msw-launcher.png -vf "scale=256:256:flags=lanczos" "$APP_DIR/MSW.png"
# 标准 hicolor 图标布局（appimagetool 与 AppImageLauncher / 文件管理器识别依赖它）
mkdir -p "$APP_DIR/usr/share/icons/hicolor/256x256/apps"
ffmpeg -y -loglevel error -i assets/msw-launcher.png -vf "scale=256:256:flags=lanczos" "$APP_DIR/usr/share/icons/hicolor/256x256/apps/MSW.png"
mkdir -p "$APP_DIR/usr/share/icons/hicolor/512x512/apps"
ffmpeg -y -loglevel error -i assets/msw-launcher.png -vf "scale=512:512:flags=lanczos" "$APP_DIR/usr/share/icons/hicolor/512x512/apps/MSW.png"
mkdir -p "$APP_DIR/usr/share/applications"
cp "$APP_DIR/MSW.desktop" "$APP_DIR/usr/share/applications/MSW.desktop"

echo "==> 4/6 准备 appimagetool"
if [ ! -x "$APPIMAGE_TOOL" ]; then
    curl -sL --retry 3 --retry-delay 2 -o "$APPIMAGE_TOOL" "$APPIMAGE_URL"
    chmod +x "$APPIMAGE_TOOL"
    # 校验下载的是 ELF 二进制而非 HTML 错误页
    if ! file "$APPIMAGE_TOOL" | grep -q 'ELF'; then
        echo "错误：appimagetool 下载失败（非 ELF 二进制），请检查网络或手动放置。" >&2
        rm -f "$APPIMAGE_TOOL"
        exit 1
    fi
fi

echo "==> 5/6 打包 AppImage"
"$APPIMAGE_TOOL" --appimage-extract-and-run "$APP_DIR" "$BUILD_DIR/MSW-Linux-x86_64.AppImage"

echo "==> 6/6 生成缩略图缓存（缺 libappimage 的系统上让文件管理器显示图标）"
if uv run python "$REPO_ROOT/scripts/make-appimage-thumbnail.py" "$BUILD_DIR/MSW-Linux-x86_64.AppImage"; then
    echo "    缩略图缓存已生成"
else
    echo "    警告：缩略图缓存生成失败（不影响 AppImage 本身）"
fi

echo "==> 完成：$BUILD_DIR/MSW-Linux-x86_64.AppImage"
