# 绑定着色、配置说明与播放头保存

基线 `d8811892`。保留个人日志、配置和用户工程。将“记录上传播放的位置”按“记录上次播放位置”处理：保存时记录，重新打开后定位，不自动播放。

| 请求 | 状态 | 范围与证据 |
| --- | --- | --- |
| 绑定字幕连锁着色 | 已修复 | 核心 setColor 扩展绑定对象；主／副入口使用同一次事务，保留选择。14 项编辑单测、1 项浏览器双向着色／清除／撤销测试通过。首次浏览器失败是测试误用副字幕函数参数，修正夹具后通过。 |
| 配置管理“详情说明” | 已修复 | 已核对配置登记表，四段短说明区分工程、个人配置、不导出内容及导入生效规则；启动器和编辑器共享说明。4 项配置浏览器测试通过，涵盖展开说明、导入不改工程、便携版及启动器；截图核对折叠入口沿用现有布局。 |
| 保存及恢复播放头 | 已修复 | 根部 editor_state.playhead_ms 记录共享时钟；普通保存、另存／下载、文件句柄、恢复快照均接入，重开暂停定位。4 项浏览器测试通过：读写、保存期间跳转、切换工程、旧工程、缩短媒体、加载期间的新跳转、视频后音频及纯贴片时间轴。首次测试发现加载媒体会清掉排队跳转，修正预览附加媒体路径后通过。 |
| 回归及生成产物 | 已修复 | Node 全量 717、Python 相关 104、浏览器 13 个不同用例通过。schema、配置帮助、changelog 和 blank-editor.html 已更新；离线对比工具重新构建且无差异。 |

验证命令与边界：

- `node --test tests/test*.mjs`（PowerShell 枚举文件）717/717；日志 `output/binding-playhead-node.log`。
- 隔离 TEMP、MSW_APP_DATA_ROOT、MAW_ENV_FILE，Python unittest：`test_msw_persistence test_msw_processing test_flat_subtitles test_flat_subtitles_io test_config_transfer test_user_config test_packaging_contract`，104/104；日志 `output/binding-playhead-python.log`。未运行不相关 Python 全量。
- Playwright：`config-manager.spec.mjs` 4，`project-playhead.spec.mjs` 4，`speaker-palette.spec.mjs` 5。均使用合成媒体及隔离工程，不调用云端或改写用户工程。
- `.venv/Scripts/python.exe edit.py --blank`、`scripts/build_comparison_tools.py` 成功；语法和 diff 检查通过。
- 仅移动播放头不触发自动保存或离开警告，磁盘记录以最近一次工程保存为准。尚未加载媒体时保留原保存位置，用户主动导航优先；未知／无效导航值忽略。
- 8250 未检测到运行服务，无须重启。下次启动／刷新页面加载本轮前端修改。
