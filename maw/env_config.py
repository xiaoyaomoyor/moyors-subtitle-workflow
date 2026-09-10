"""Dependency-free MSW/MAW configuration aliases shared by file and process readers."""

from collections.abc import Mapping, MutableMapping
from pathlib import Path


def aliased_values(values: Mapping[str, str]) -> dict[str, str]:
    """Within one source, an explicit MSW key takes precedence, including empty values."""
    result = dict(values)
    for key, value in values.items():
        if key.startswith("MSW_"):
            result["MAW_" + key[4:]] = value
    return result


def apply_msw_env_aliases(values: MutableMapping[str, str] | None = None) -> None:
    import os

    scope = os.environ if values is None else values
    scope.update(aliased_values(scope))


def read_env(path: Path) -> dict[str, str]:
    try:
        lines = Path(path).read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        return {}
    values = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return aliased_values(values)


def alias_keys(key: str) -> tuple[str, ...]:
    if key.startswith(("MSW_", "MAW_")):
        return ("MSW_" + key[4:], "MAW_" + key[4:])
    return (key,)
