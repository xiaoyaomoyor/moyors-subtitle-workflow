# 启动器统一工程读取与操作检查（2026-10-17）

基线：`d20c877b`，`my-feature`。承接 `PLAN_LAUNCHER_FLAT_TRACK_AUDIT_20261017.md` 第一阶段。
保留本机 `debug.log`、`.test-appdata/`、`output/`，不读取密钥或修改用户工程。

| 项目 | 状态 | 范围与证据 |
| --- | --- | --- |
| 统一新旧工程读取、字幕统计与能力描述 | 已修复 | 共用 read_project（支持 BOM）、launcher_project 的计数/轨道快照/操作能力；无旧 segments 镜像 |
| 接通媒体关联、补波形、派生工程保存 | 已修复 | 合成 WAV 经真实 FFmpeg 生成缓存、复制至另一目录；保留 cues/tracks/bindings、音频贴片、来源引用与素材字节，原工程不变 |
| 未适配操作的统一前置检查 | 已修复 | 队列预检与执行复检、独立后处理/文稿/OCR、初次及恢复流水线、SRT 产物、对齐和旧方案入口使用共用检查；缺失/空对齐目标在模型前拒绝 |
| 启动器反馈与回归验证 | 已修复 | 保留布局；默认产物与能力匹配，时间码工具显示实际轨道及限制；Python/Node/浏览器回归和打包契约通过 |
| 全轨道处理、任意重叠导入与比较工具 | 仅说明 | 后续阶段，本轮不实现 |

## 验证记录

- `tests.test_launcher_flat_project`：5 项通过；涵盖三轨、空轨、禁用/隐藏/锁定、旧工程禁用副轨、BOM、非法版本/归属及源文件不变。
- 首批 77 项执行时 76 项通过，新增夹具未同步 next_track_number 导致一项校验错误；修正夹具后上述 5 项通过。
- 初次沙箱运行因 Windows 临时目录权限失败，使用获准的外部测试进程后正常；不是产品测试结果。
- 配置 MSW_TEST_FFMPEG 后新增实际波形/素材验证：6 项通过，FFmpeg 8.1.2 生成 200 peaks 和 quapeaks 缓存。未调用收费服务。
- 扩充操作边界后，`tests.test_launcher_flat_project tests.test_launcher_queue tests.test_launcher_r4 tests.test_timestamp_alignment tests.test_postprocess_pipeline`：101 项通过。显式 SRT 请求拒绝，不发布部分产物；默认自动输出按任务版本选择工程/工程加 SRT；恢复流水线按实际输入检查。
- 最终新增 14 项平级轨道回归；与卡片回归合计 61 项通过。未知未来版本卡片明确报错，不显示为 0 字幕；旧工程只有叠加字幕时输出 SRT。
- Chromium：`launcher-flat-read.spec.mjs launcher-queue.spec.mjs launcher-config-output.spec.mjs` 共 23 项通过。新增用例使用生产 Python 返回的信息，验证默认预计产物、显式输出/后处理预检及时间码目标与状态切换；不以浏览器模拟队列作为实际服务运行证据。
- 全量 Node：668 项通过。改动文件的 Ruff、JS 语法及 `git diff --check` 通过；已执行 `uv run --frozen --no-sync python edit.py --blank`，产物与构建函数一致且无需内容变更，文本保持 UTF-8/LF。
- 首次全量 Python：2,138 项，23 跳过；2 项打包依赖检查失败，已补齐 MSW.spec 的 local-runtime/ocr-runtime 公共模块；7 项错误由测试父进程默认 GBK 与 PYTHONIOENCODING=UTF-8 的子进程输出不一致导致（包含读文件解码）。补充 PYTHONUTF8=1 后复验。全程使用独立 MSW_APP_DATA_ROOT，避免修改用户配置和工程登记。
- 修正后 `tests.test_packaging_contract tests.test_gui_workflow tests.test_local_runtime tests.test_msw_output_layout tests.test_openai_asr`：144 项全部通过。
- 最终全量 Python：`python -m unittest discover -s tests -p 'test_*.py'` 在独立数据目录、PYTHONUTF8=1 与 FFmpeg PATH 下运行 2,138 项，2,115 通过、23 跳过，无失败/错误（333.423 秒）。日志位于工作区外的本轮检查目录，未纳入仓库。

## 本轮交付边界

- 保留现有启动器布局。默认输出根据每个任务能力选择；用户显式选择不支持的操作则提前阻止，不将缺失轨道或空范围报告为成功。
- 后续仍需实现平级轨道的来源/目标选择及识别、翻译、整理、时间码和字幕导出；多并发字幕导入及比较工具留到后续阶段。本轮不做旧模型镜像或降级，不调用云服务/真实对齐模型。
- Python 启动器进程需重新打开以加载更新；本轮无需重启正在运行的编辑器服务。
- 本轮范围内无阻塞项。未构建新的发行包、未执行真实云端识别/翻译或加载对齐模型；打包证据为依赖闭包契约检查。此前的测试环境及打包遗漏均已修正、复验。
