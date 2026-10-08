"""An estimate for video encoding only, based on measured completed frames."""

import math
import time


class EncodingEstimate:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.reset()

    def reset(self):
        self.started = self.sample_at = self.clock()
        self.previous = self.sample_fraction = 0
        self.speed = None

    def update(self, stage, fraction):
        if stage != 'video':
            self.reset()
            return None
        current = min(1, max(0, (fraction - .55) / .37))
        if current < self.previous or current == 0:
            self.reset()
        self.previous = current
        now = self.clock()
        elapsed = now - self.sample_at
        if elapsed >= 1 and current > self.sample_fraction:
            measured = (current - self.sample_fraction) / elapsed
            self.speed = measured if self.speed is None else .25 * measured + .75 * self.speed
            self.sample_at, self.sample_fraction = now, current
        if now - self.started < 4 or not self.speed or current <= 0 or current >= .9999:
            return None
        return max(1, math.ceil((1 - current) / self.speed))
