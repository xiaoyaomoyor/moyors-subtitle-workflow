"""Publish a named set of project/original/translated/bilingual artifacts together."""
from pathlib import Path

from maw.postprocess_io import read_project, write_derived_project, _atomic_write


def publish_outputs(*, project: Path, anchor: Path, original: Path | None,
                    translated: Path | None = None, bilingual: Path | None = None,
                    export_project: bool = True, warnings: list | None = None,
                    original_target: Path | None = None):
    anchor = anchor.expanduser().resolve()
    original_target = original_target.expanduser().resolve() if original_target else anchor
    stem, count = anchor.stem, 0
    while True:
        name = stem + (f"-{count}" if count else "")
        paths = {
            "projectPath": anchor.with_name(name + ".mosp") if export_project else None,
            "srtPath": original_target.with_name(original_target.stem + (f"-{count}" if count else "") + ".srt") if original else None,
            "translatedSrtPath": anchor.with_name(name + ".translated.srt") if translated else None,
            "bilingualSrtPath": anchor.with_name(name + ".bilingual.srt") if bilingual else None,
        }
        destinations = [str(path).casefold() for path in paths.values() if path]
        if len(set(destinations)) == len(destinations) and all(not path.exists() for path in paths.values() if path):
            break
        count += 1
    # Read every requested input before publishing the first file.
    contents = {field: source.read_text(encoding="utf-8-sig") for field, source in
                (("srtPath", original), ("translatedSrtPath", translated), ("bilingualSrtPath", bilingual)) if source}
    if export_project:
        notices = write_derived_project(read_project(project), paths["projectPath"], project)
        if warnings is not None:
            warnings.extend(notices)
    for field, content in contents.items():
        _atomic_write(paths[field], content)
    return {field: str(path or "") for field, path in paths.items()}
