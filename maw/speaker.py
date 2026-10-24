from __future__ import annotations

from copy import deepcopy
import colorsys

from maw.colors import COLOR_PALETTE


def inherit_speaker_color(source: dict, target: dict, color_head: dict | None = None) -> None:
    """Fill translated cue metadata without replacing its existing custom marks.

    Materialize the effective color on the target's own span: source indices or
    cue IDs cannot safely be copied into a different/subset translation track.
    """
    if source.get("speaker") is not None and not target.get("speaker"):
        target["speaker"] = source["speaker"]
    color = source.get("color") or (color_head or {}).get("color")
    if color and not target.get("color") and not target.get("color_ref"):
        target["color"] = {**deepcopy(color), "start": target["start"], "end": target["end"]}


# speaker 只是调色板的取色者之一：色值权威定义见 maw/colors.py。
def split_items_by_speaker(items: list[dict]) -> list[list[dict]]:
    """按 speaker 变化硬切分，避免两个说话人进入同一字幕段。

    缺少 speaker 的 item 跟随前一个已知 speaker，不主动制造切分。
    """
    runs: list[list[dict]] = []
    current: list[dict] = []
    current_speaker: str | None = None
    for item in items:
        speaker = item.get("speaker")
        if (
            current
            and speaker is not None
            and current_speaker is not None
            and speaker != current_speaker
        ):
            runs.append(current)
            current = []
            current_speaker = None
        current.append(item)
        if speaker is not None:
            current_speaker = speaker
    if current:
        runs.append(current)
    return runs


def apply_speaker_colors(segments: list[dict]) -> dict:
    """按首次出现分配稳定身份；超过五人继续创建独立颜色，不循环复用。"""
    speaker_order: list[str] = []
    for seg in segments:
        speaker = seg.get("speaker")
        if speaker and speaker not in speaker_order:
            speaker_order.append(speaker)
    if not speaker_order:
        return {"speakers": [], "colored_segments": 0, "overflow": False}

    def palette_entry(index):
        if index < len(COLOR_PALETTE):
            return COLOR_PALETTE[index]
        rgb = colorsys.hls_to_rgb((index * 137.508 % 360) / 360, .62, .55)
        return f'speaker-{index+1}', '#' + ''.join(f'{round(v*255):02x}' for v in rgb)
    palette_of = {
        speaker: palette_entry(index)
        for index, speaker in enumerate(speaker_order)
    }

    colored = 0
    index = 0
    while index < len(segments):
        speaker = segments[index].get("speaker")
        if not speaker:
            index += 1
            continue
        end_index = index
        while (
            end_index + 1 < len(segments)
            and segments[end_index + 1].get("speaker") == speaker
        ):
            end_index += 1
        name, value = palette_of[speaker]
        segments[index]["color"] = {
            "name": name,
            "value": value,
            "start": segments[index]["start"],
            "end": segments[end_index]["end"],
        }
        for ref_index in range(index + 1, end_index + 1):
            segments[ref_index]["color_ref"] = {
                "name": name,
                "headIdx": index,
            }
        colored += end_index - index + 1
        index = end_index + 1

    return {
        "speakers": speaker_order,
        "colored_segments": colored,
        "overflow": False,
    }
