"""字幕颜色调色板：分组着色（color / color_ref）的唯一权威定义。

这五色作为说话人色系的初始颜色；工程内的 speaker_palette 可继续添加、改色。
手动标记、speaker 自动取色、拆分继承共享稳定身份。由 edit.py / serve.py 渲染时
注入为 ``window.ASR_EDITOR_PALETTE``；JSON_SCHEMA.md 第四节的色值表
与这里保持同步。

五色明度（OKLCH L）以绿色为锚统一（L≈0.718），红/蓝/黄彩度随锚点
收敛（C≈0.142），色相各自保留；色值最终以 HEX 落盘，OKLCH 仅作
调色参考。
"""

from __future__ import annotations

COLOR_PALETTE: tuple[tuple[str, str], ...] = (
    ("yellow", "#c4a019"),
    ("green", "#66bb6a"),
    ("red", "#f07f6f"),
    ("purple", "#bf89e6"),
    ("blue", "#61a7fa"),
)

COLOR_NAMES: frozenset[str] = frozenset(name for name, _ in COLOR_PALETTE)
