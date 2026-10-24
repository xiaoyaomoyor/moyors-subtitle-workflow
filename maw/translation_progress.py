"""Validated translation batches retained beside a pipeline's recovery input."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from maw.file_io import atomic_write_text


def fingerprint(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


class TranslationProgress:
    def __init__(self, path: Path | None, identity: object):
        self.path = path
        self.identity = fingerprint(identity)
        self.batches: dict[str, dict] = {}
        if path is not None:
            try:
                if path.stat().st_size > 64 * 1024 * 1024:
                    return
                saved = json.loads(path.read_text(encoding='utf-8'))
                if (isinstance(saved, dict) and saved.get('version') == 1
                        and saved.get('fingerprint') == self.identity and isinstance(saved.get('batches'), dict)):
                    self.batches = saved['batches']
            except (OSError, UnicodeError, ValueError):
                # Incomplete/corrupt progress is never treated as translated text.
                pass

    def get(self, cues: list[dict]) -> dict | None:
        result = self.batches.get(fingerprint(cues))
        return copy.deepcopy(result) if isinstance(result, dict) else None

    def save(self, cues: list[dict], response: dict) -> None:
        if self.path is None:
            return
        self.batches[fingerprint(cues)] = copy.deepcopy(response)
        atomic_write_text(self.path, json.dumps({'version': 1, 'fingerprint': self.identity,
            'batches': self.batches}, ensure_ascii=False, indent=2) + '\n')
