"""Build standalone offline comparison pages from web sources."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES = ('msw-subtitle-animation.js', 'msw-cue-style.js', 'msw-subtitle-layers.js', 'msw-subtitle-tracks.js', 'msw-flat-subtitles.js',
                'tools/project-tracks.js')


def build(name):
    scripts = '\n'.join('<script>\n' + (ROOT / 'web' / path).read_text(encoding='utf-8')
                        + '\n</script>' for path in DEPENDENCIES)
    source = (ROOT / 'web' / 'tools' / name).read_text(encoding='utf-8')
    return source.replace('<!-- MSW_COMPARISON_DEPENDENCIES -->', scripts)


if __name__ == '__main__':
    for name in ('compare.html', 'timestamp-compare.html'):
        (ROOT / 'tools' / name).write_text(build(name), encoding='utf-8', newline='\n')
