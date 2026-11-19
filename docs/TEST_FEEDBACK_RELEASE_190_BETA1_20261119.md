# MSW v1.9.0-beta.1 发布记录

2026-11-19 用户明确授权发布已验收版本。沿用 [发布准备记录](TEST_FEEDBACK_RELEASE_190_BETA1_PREP_20261118.md) 的候选 `f7b91b6147e99e060edb700bf78a34aaabea91fa` 与[成功构建 44257196052](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44257196052) 五包；发布标签仅额外包含发布日期、下载入口与验收文档更新，程序代码及打包资源须与候选一致。

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 发布前核对 | 已修复 | 同名标签与 Release 不存在；候选构建成功；五包重新检查结构、CRC、大小和 SHA-256，与准备记录一致；版本同步和发行说明格式通过。 |
| 草稿与五包上传 | 已修复 | 全部五包上传完成，远端 state、大小与 SHA-256 均匹配验收清单后才公开。 |
| 公开与下载核对 | 已修复 | 已作为 prerelease 公开；标签、说明、五包摘要一致；页面、五个附件及两种源码归档匿名访问全部返回 200。稳定版仍为 v1.7.0。 |
| 其他功能与已知边界 | 仅说明 | 不扩展功能；完整回归、532 项浏览器检查、三平台原生验证及未实测范围沿用准备记录。 |

原有 `debug.log` 35 行及 `.test-appdata/`、`output/`、`tests/test_data/_msw/` 保留；`main` 保持 `a8bf4384`。不读取个人 `.env`。

- 更新中英文 README、安装说明至 v1.9.0-beta.1 下载入口；CHANGELOG 发布日期为 2026-11-19，并将候选措辞更新为预发行版。通过 `scripts/prepare_release_notes.py` 生成实际发行说明，再用 `scripts/check_release_assets.py` 附加五包 SHA-256，核对加粗格式与全部文件名。
- 发布目标与已验收候选的差异限制为上述公开文档和两份验收记录；禁止将其他产品变更带入标签。无需因纯文档更新重复上一轮完整构建，继续使用成功预演的五包。
- 发布目标提交为 `732a91fbf00f997d6f6dd1fae0b91c104708288b`；草稿 Release ID `450837422`。与构建候选的文件差异白名单检查、UTF-8/LF 和 `git diff --check` 通过，五包摘要仍与准备记录完全一致。

## 发布结果

- [MSW v1.9.0-beta.1](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.9.0-beta.1) 于 2026-11-19 11:38（Asia/Shanghai）公开。Release ID `450837422`，`draft=false`、`prerelease=true`；未改动 v1.7.0 稳定版入口。
- 标签 `v1.9.0-beta.1` 指向 `732a91fbf00f997d6f6dd1fae0b91c104708288b`，已同步本地；相对验收候选仅增加文档，不引入未验证程序变更。发行说明与本机生成内容逐字一致。
- 五个附件的 GitHub 服务端 SHA-256 和大小均与准备记录一致。匿名访问发布页面返回 200；五个安装包及 Source code ZIP／tar.gz 都返回 200，流式读取文件头确认格式正确。未把文件头抽查表述为再次全量下载；完整摘要由上传后的服务端摘要与已验收本地文件比对。
- 发布会触发同标签自动构建。为避免再次构建覆盖已验收附件，仅停止本次标签对应的[重复运行 44452881756](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44452881756)；实际验收依据仍为成功预演 `44257196052`。
- 本轮只有发布文档更新和已验收五包的上传／公开，没有重复运行完整功能回归，也没有扩展功能范围。无剩余发布阻塞；条件跳过、71 条既有 Ruff 诊断和真实云端／完整模型下载／实体 MPS 未实测范围见准备记录。
