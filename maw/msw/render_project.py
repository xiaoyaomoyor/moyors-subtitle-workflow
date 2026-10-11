"""Validated render inputs. Accept v4 only in explicitly adapted render paths."""
from copy import deepcopy
from maw.project import normalize_project


def normalize(project):
    if not isinstance(project, dict) or project.get('schema') != 'msw.project.v4':
        return normalize_project(project)
    from maw.msw.flat_subtitles import validate
    from maw.msw.project_codec import normalize_extension
    validate(project)
    result = deepcopy(project)
    extension = normalize_extension(result.get('msw'))
    if extension is not None:
        result['msw'] = extension
    return result


def visible_cues(project):
    tracks = {t['id']: t for t in project['subtitles']['tracks']}
    return [c for c in project['subtitles']['cues']
            if tracks[c['track_id']]['enabled'] and not c.get('hidden') and not c['content'].get('disabled')]
