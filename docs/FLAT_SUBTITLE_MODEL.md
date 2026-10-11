# 平级字幕 v4：底层与兼容

本阶段落实“所有字幕轨道平级独立，主副改为可选对应关系”。当前编辑器仍使用 v3；v4 不自动加载为工作工程，也不自动覆盖个人文件。下一阶段再接入界面、编辑历史、识别、翻译、配音和渲染。

## 数据模型

顶层版本为 `msw.project.v4`，字幕模型为 `msw.subtitles.v1`。`subtitles.cues[*].content` 是唯一可编辑字幕正文；不再在根部保存 `segments`、`multi_subtitle`、`subtitle_tracks`、`subtitle_layers` 或 `overlay_track`。

```json
{
  "schema": "msw.project.v4",
  "media": "clip.mp4",
  "subtitles": {
    "schema": "msw.subtitles.v1",
    "tracks": [
      {
        "id": "track-a", "name": "原文", "purpose": "source", "layout": "auto",
        "enabled": true, "locked": false, "collapsed": false,
        "style": {"mode": "inherit", "slot": "main", "base": "dialogue"}
      },
      {
        "id": "track-b", "name": "译文", "purpose": "translation", "layout": "auto",
        "enabled": true, "locked": false, "collapsed": false,
        "style": {"mode": "inherit", "slot": "secondary", "base": "dialogue"}
      }
    ],
    "cues": [
      {"id": "cue-a", "track_id": "track-a", "content": {"start": 0, "end": 2000, "text": "Hello", "items": []}},
      {"id": "cue-b", "track_id": "track-b", "content": {"start": 100, "end": 2100, "text": "你好", "items": []}}
    ],
    "bindings": [
      {"id": "pair-a", "source_id": "cue-a", "target_id": "cue-b", "start_offset_ms": 100, "end_offset_ms": 100}
    ]
  }
}
```

### 轨道与字幕

- 轨道 ID、名称与字幕 ID 均为非空字符串，最多 160 个 UTF-16 单元。轨道与字幕的 ID 各自在工程内唯一；轨道数组决定顺序。没有父子轨道、隐式副轨或第二份轨道内正文。
- `purpose` 是可选用途的枚举，必须保存为 `none`、`dialogue`、`source`、`translation`、`annotation` 之一。它不决定绑定方向、操作权限或样式。`layout` 独立为 `auto`／`fixed`。
- `enabled/locked/collapsed` 必须为布尔值。`position` 可选，使用画面内的 `{x,y}` 比例；`language` 可保留旧语言轨标记。
- 每条字幕恰好归属一条轨道。同轨字幕不可重叠，边界相接合法；跨轨允许重叠，禁用字幕也占据自己的区间。
- 字幕 `content` 承载原文、整数毫秒时间、逐词时间码、可选帧时间码、颜色／表情包、说话人、字幕定位及未知扩展字段。旧 `id` 移到身份映射，其余字段不因新轨道字段而被覆盖；例如旧正文的未知 `track_id` 留在 `content.track_id`。
- 逐词条目按时间排列且位于字幕范围内；允许旧契约中的零时长词条。毫秒时间与成对帧时间均保留，不在迁移时重新量化。
- 字幕级 `hidden` 仅用于保留旧隐藏叠加组的显示状态，独立于 `content.disabled`。默认查询隐藏轨道／隐藏字幕会被过滤；`include_hidden/includeHidden` 可取全量内容。

轨道 `style` 沿用现有 `mode: inherit/snapshot`、`value`、`custom`、`selection` 契约，增加 `slot: main/secondary` 与 `base: dialogue/annotation`。这两个字段是旧样式的查找位置，不是字幕的存储身份或绑定限制。已有独立样式、注释样式、工程预设及位置完整保留；生产渲染接入时还需把它们映射到平级轨道。

### 对应关系与引用

- `bindings` 仅表达明确建立的一对一关系。每条字幕至多参加一组，双方在不同轨道；不根据时间接近程度自动绑定，也不因换轨自动解绑。
- `source_id/target_id` 标识关系方向，不强制双方用途。可从任意一边建立关系。两个偏移分别等于目标字幕的开始／结束时间减来源字幕相应时间；不一致、重复端点、失效引用均拒绝。
- 底层 `move` 仅移动显式传入的字幕 ID；绑定另一侧留在原轨，关系保持。移动到同轨冲突、与绑定伙伴同轨或涉及锁定轨道时整次拒绝。界面是否主动选择两侧联动属于后续操作层的决策。
- 颜色／表情包引用由易变的 `headIdx` 转为 `cue_id`，直接指向含实际标记的字幕。字幕数组重排和换轨不改变引用；不允许失效、自引用、引用与头标记并存或循环引用。

当前仍保持一对一关系，未扩展为同一字幕同时绑定多个翻译目标；所有语言轨道及未绑定内容都会迁移，不会合并成单一副轨。

## 旧工程迁移

`migrate/migrate_project` 接受无版本／v1／v2／v3 工程。先复用既有 v3 迁移（生成缺失 ID、合并旧叠加内容、保留显示元数据），再按“旧显示归属＋原语言存储”拆成平级轨道。旧主字幕轨保留 ID；副字幕所在轨得到独立 ID。空主轨和空语言轨也保留。

每条旧字幕使用 `(role, track_id, cue_id)` 生成稳定的全局 ID；主副原 ID 相同也不会冲突。算法是 UTF-16LE 的 FNV-1a 64 位标识编码，**不用于安全校验**；发现碰撞立即拒绝，不合并字幕。新建字幕应由调用端分配不重复的稳定 ID，不再使用旧角色作为身份。

迁移结果附带 `subtitles.migration`：

| 字段 | 内容 |
| --- | --- |
| `schema` | `msw.subtitle-migration.v1` |
| `identities` | 新字幕 ID 与旧角色／存储 ID／字幕 ID 的对应；必要时保存被新标记引用占用的旧扩展字段 |
| `structure` | 旧结构配置快照；原正文数组改为新字幕 ID 列表，不保存第二份正文 |

迁移记录用于来源解析和兼容校验，不参与平级轨道的归属决策。旧配音素材、贴片、任务结果、缓存、媒体相对路径和预览配置保留；历史任务中的原文快照仍是历史数据，不是可编辑字幕真源。已删除字幕的来源映射可以保留，查询返回空，不以数组位置或同名字幕补配。

`resolveSource/resolve_source` 支持旧配音来源 `{id,track_id}`、素材库来源 `{source_cue_id,track_id}`，以及新显式引用 `{subtitle_cue_id}`。显式新引用失效时不回退到旧字段；纯配音草稿 `kind: editor_text` 不解析为字幕。此接口尚未替换生产处理流程的旧引用读取。

### 兼容视图边界

`legacyProjection/legacy_projection` 用于生成可核查的 v3 视图。它会重新迁移并比对完整轨道、正文与关系，只有能无损表达时才返回。初次迁移可以精确还原规范化后的 v3；由该视图生成的 ASS 和精确预览与迁移前一致。

这是兼容验收工具，不是自动降级保存。平级轨道新增、独立换轨、关系变更等无法由旧来源结构表达的修改，或没有迁移来源的原生 v4，都明确拒绝还原。当前实现对原数组顺序也采用保守比对。v1 迁移沿用既有规范化，不承诺 JSON 字节相同；原文件备份保留原始字节。

## 接口与读写

| JavaScript | Python | 作用 |
| --- | --- | --- |
| `validate` | `validate` | 严格验证新字幕契约，不修补失效引用 |
| `migrate` | `migrate_project` | 纯迁移；再次迁移 v4 幂等 |
| `createIndex` | `SubtitleIndex` | 按稳定 ID 查询、查轨道、对应字幕和旧来源 |
| `addTrack` | `add_track` | 添加独立轨道，拒绝重复 ID |
| `move` | `move` | 按显式字幕 ID 原子换轨 |
| `bind/unbind` | `bind/unbind` | 原子建立／取消对应关系，保留内容 |
| `legacyProjection` | `legacy_projection` | 无损 v3 兼容视图，无法表达则拒绝 |

JS 模块为 `web/msw-flat-subtitles.js`，便携与本机页面提供 `MSWFlatSubtitles`；Node 可 `require`。Python 为 `maw.msw.flat_subtitles`。修改操作返回新对象，不改变传入工程；索引属于快照，编辑后重新建立。原生 v4 不要求 `migration`，可直接使用新 ID、平级轨道和关系。

独立读写模块 `maw.msw.flat_subtitles_io` 提供 `read_project`、`serialize_project`、`save_project`。默认命令只检查，不写文件：

```powershell
uv run python -m maw.msw.flat_subtitles_io "synthetic-project.mosp"
```

仅开发验收需要实际写回时，显式传 `--write-v4`。当前编辑器尚不能打开写出的 v4，因此不要用工作工程做此验收。第一次升级在同目录创建短名称 `.msw-tracks-backup-*.mosp`，保存原 BOM、空白与换行等字节；工程写回原位置，不改变相对媒体和 `.assets` 目录。

两代轨道迁移工具共用互斥锁。写回前及原子替换前检查取消和原文件字节；检测外部修改就拒绝覆盖。备份／临时文件 fsync 或替换失败会保留原文件。忽略本工具文件锁的外部程序仍不可在最终操作系统替换瞬间并发保存。

重复 JSON 字段、非有限数值、无法在 JS 精确表达的整数、无效字幕结构和未来版本均拒绝。v4 字幕契约与 JSON 可保存性由新模块验证；其余保留的历史扩展不会作为新生产流程执行。当前编辑器及旧 codec 不接受 v4，也不能用旧快照覆盖磁盘上的 v4。

## 下一阶段接入

1. 让打开、保存、恢复和撤销统一使用 v4，旧数组仅作为明确的临时适配视图。
2. 波形、列表、字幕编辑器按平级轨道及稳定字幕 ID 查询；把切分、合并、换轨与多选改为显式关系操作。
3. 识别选择目标轨道，翻译选择来源／目标，配音素材使用新引用并兼容旧别名；继续保护迟到任务和锁定轨道。
4. 预览、ASS 和烧录按轨道样式与排布渲染，保持迁移前画面；完成实际界面与处理回归后再切换默认版本。

本轮验证记录见 [迁移验收记录](TEST_FEEDBACK_FLAT_SUBTITLE_MODEL_20261011.md)。
