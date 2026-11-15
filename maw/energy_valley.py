"""Conservative audio refinement of newly interpolated ASR boundaries only.

Read short windows from prepared PCM WAVs without optional dependencies.
Other local audio formats may use the ASR runtime's soundfile installation.
The call belongs before cue filtering/repair and before applying a clip offset.
"""

from array import array
from contextlib import contextmanager
import math
from pathlib import Path
import sys
import wave


FRAME_MS = 20
MAX_SHIFT_MS = 400
MIN_CUE_MS = 100
DIP_RATIO = .5


@contextmanager
def _audio_windows(path):
    """Yield (rate, samples, read_energy); keep memory bounded per cut."""
    source = None
    try:
        source = wave.open(str(path), 'rb')
        if source.getsampwidth() != 2 or source.getcomptype() != 'NONE':
            source.close()
            source = None
    except (OSError, EOFError, wave.Error):
        if source is not None:
            source.close()
        source = None
    if source is not None:
        try:
            rate, channels = source.getframerate(), source.getnchannels()
            size = max(1, round(rate * FRAME_MS / 1000))

            def read_energy(first, count):
                source.setpos(first * size)
                values = array('h', source.readframes(count * size))
                if sys.byteorder != 'little':
                    values.byteswap()
                width = size * channels
                # Sum channel energies; opposite-phase stereo must not cancel.
                return [math.sqrt(sum(v * v for v in values[i:i + width]) / width)
                        for i in range(0, len(values) - width + 1, width)]

            yield rate, size, source.getnframes(), read_energy
        finally:
            source.close()
        return

    # Lazy and optional: cloud/source installs do not need a new audio library.
    import soundfile as sf
    with sf.SoundFile(str(path)) as source:
        rate = source.samplerate
        size = max(1, round(rate * FRAME_MS / 1000))

        def read_energy(first, count):
            source.seek(first * size)
            values = source.read(count * size, dtype='float64', always_2d=True)
            usable = len(values) // size * size
            frames = values[:usable].reshape(-1, size, source.channels)
            return ((frames * frames).mean(axis=(1, 2)) ** .5).tolist()

        yield rate, size, len(source), read_energy


def snap_cue_boundaries(segments, audio_path, *, boundary_indices=()):
    """Return the number of refined cuts. No eligibility means no audio I/O.

    Only the splitter can identify new internal interpolated boundaries. Never
    infer eligibility merely from missing word items or saved timing_precision.
    Missing/unsupported audio degrades to the original interpolation unchanged.
    """
    if not boundary_indices or not audio_path:
        return 0
    eligible = sorted({i for i in boundary_indices if type(i) is int and 0 < i < len(segments)})
    if not eligible:
        return 0
    # Stage changes so a failed read midway cannot leave a partially refined job.
    times = [[s.get('start'), s.get('end')] for s in segments]
    moved = []
    try:
        path = Path(audio_path)
        if not path.is_file():
            return 0
        with _audio_windows(path) as (rate, size, sample_count, read_energy):
            if rate <= 0 or size <= 0:
                return 0
            frame_ms = 1000 * size / rate
            for index in eligible:
                previous, current = segments[index - 1:index + 1]
                if previous.get('items') or current.get('items'):
                    continue
                start, boundary = times[index - 1]
                next_start, end = times[index]
                if (not all(type(v) is int for v in (start, boundary, next_start, end))
                        or boundary != next_start or not 0 <= start < boundary < end):
                    continue
                lo = max(start + min(MIN_CUE_MS, boundary - start), boundary - MAX_SHIFT_MS)
                hi = min(end - min(MIN_CUE_MS, end - boundary), boundary + MAX_SHIFT_MS)
                first = max(0, math.ceil(lo / frame_ms - .5))
                last = min(sample_count // size, math.floor(hi / frame_ms - .5) + 1)
                if last <= first:
                    continue
                window = read_energy(first, last - first)
                if len(window) != last - first or any(not math.isfinite(v) or v < 0 for v in window):
                    continue
                mean, quiet = sum(window) / len(window), min(window)
                if mean <= 0 or quiet > mean * DIP_RATIO:
                    continue
                candidates = [first + i for i, value in enumerate(window) if value == quiet]
                valley = min(candidates, key=lambda i: (abs((i + .5) * frame_ms - boundary), i))
                snapped = round((valley + .5) * frame_ms)
                if snapped == boundary or not lo <= snapped <= hi or not start < snapped < end:
                    continue
                times[index - 1][1] = times[index][0] = snapped
                moved.append((index, snapped))
    except (ImportError, OSError, RuntimeError, ValueError, EOFError, wave.Error):
        return 0
    for index, snapped in moved:
        segments[index - 1]['end'] = segments[index]['start'] = snapped
    return len(moved)
