# MSW 品牌图标

产品名称为 Moyor's Subtitle Workflow（MSW），中文名“我的字幕流”；启动器称 MSW Launcher，编辑器称 MSWE。图形来自维护者提供的 SubtitleFlow Launcher / Editor SVG，文件名不表示产品改名为 SubtitleFlow。

| 场景 | 唯一源文件 | 使用方式 |
| --- | --- | --- |
| Launcher 页头与 favicon | `web/launcher/logo.svg` | 同源 SVG，相对地址兼容本机 WebView 与浏览器 |
| MSWE 菜单图标与 favicon | `web/favicon.svg` | `edit.py` 将同一 SVG 内嵌为 Data URI，便携 HTML 无外部图标依赖 |
| Windows 启动器／任务栏／可执行文件 | `assets/maw.ico` | 从 Launcher SVG 生成 16、24、32、48、64、128、256 像素帧 |
| macOS Bundle | `assets/maw.icns` | 从 ICO 的 PNG 帧生成 |
| Linux AppImage | `assets/msw-launcher.png` | 1024 像素透明 PNG，打包时缩放到各系统尺寸 |

保留原稿路径与镂空：不裁剪、不拉伸、不增加不透明背景。Web 图标使用 `prefers-color-scheme` 调整主体明度，页面中的图标跟随应用主题，favicon 则由浏览器决定配色环境。系统图标不能动态换色，因此使用固定的中间紫色 `#7063a8`，兼顾亮暗背景。

沿用 `maw.ico` / `maw.icns` 路径是为了兼容现有启动器和打包脚本；其中的图案已换成 MSW 图形。历史截图和旧展示图片不作为运行时图标。共用编辑器模板的实验性 Tauri 构建同步复制 SVG，但未更改它的 MOSE 产品命名或原生图标。

## 重新生成

开发环境使用已有 Playwright 与 Chromium，无新增生产依赖：

```sh
node scripts/build_brand_icons.mjs
python scripts/build_macos_icon.py
python scripts/build_macos_icon.py --check
python edit.py --blank
```

编辑原 SVG 后重新执行以上步骤；不要手改 ICO、ICNS 或便携 HTML 内联图标。WebView 原生标题栏／任务栏和已下载的可执行文件需重新构建后才会采用新资源，现有浏览器可能需要刷新 favicon 缓存。

## 使用规范与后续维护

- 当前官网为维护者 GitHub 仓库，文档使用 `my-feature` 分支，发行文档优先固定到对应标签。独立官网留待后续维护；上游 MAW 与实验性 MOSE 的名称不能冒充当前 MSW 的支持入口。
- 图标必须等比显示，周围至少保留图标宽度 1/8 的空间；页面菜单推荐至少 24px，Launcher 为 72px。favicon 使用同源图案，不扩大细节或裁断细线。16px 专用简化版、印刷单色版和社交封面暂保留为后续设计项，不能凭借自动描摹替换原稿。
- 标准固定色为系统图标的 `#7063a8`；Web 深浅主题版本沿用 SVG 自身规则。标志与产品文字组合时使用界面现有字体，不强制用户安装额外字体。
- README 展示图保存在 `docs/assets/msw-1.6.0-beta.1/`，仅使用演示数据；更新截图时清除 Key、个人路径、任务内容与临时提示，保证截取自真实界面。
- 编辑器“帮助 → 关于 MSWE”统一显示名称、版本、维护者、更新与反馈入口。不要为品牌替换批量改动兼容键名或历史文档。
