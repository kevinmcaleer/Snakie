"""SG90-style hobby-servo driver for MicroPython.

One servo on one PWM GPIO (50 Hz, ~0.5-2.5 ms pulse). Angle setter/getter, min/max
angle + pulse limits, blocking `sweep`, and eased motion (`ease`).

    from servo import Servo
    s = Servo(16)          # signal on GP16
    s.angle(90)            # centre
    s.sweep(0, 180)        # go end to end
    s.ease(0, 600)         # smooth glide to 0 over 600 ms
    s.detach()             # release (stop holding torque)
"""

from machine import Pin, PWM
import time


def _clamp(n, lo, hi):
    return lo if n < lo else hi if n > hi else n


class Servo:
    def __init__(self, pin, freq=50, min_us=500, max_us=2500, min_angle=0, max_angle=180):
        self._pwm = PWM(Pin(pin))
        self._pwm.freq(freq)
        self._period_us = 1_000_000 // freq  # 20000 us @ 50 Hz
        self.min_us = min_us
        self.max_us = max_us
        self.min_angle = min_angle
        self.max_angle = max_angle
        self._angle = None

    def write_us(self, us):
        """Drive a raw pulse width (µs), clamped to [min_us, max_us]."""
        us = _clamp(us, self.min_us, self.max_us)
        self._pwm.duty_u16(int(us * 65535 // self._period_us))

    def angle(self, deg=None):
        """Get the last commanded angle, or set a new one (clamped to limits)."""
        if deg is None:
            return self._angle
        deg = _clamp(deg, self.min_angle, self.max_angle)
        span = (deg - self.min_angle) / (self.max_angle - self.min_angle)
        self.write_us(self.min_us + span * (self.max_us - self.min_us))
        self._angle = deg
        return deg

    def min(self):
        """Go to the minimum angle."""
        return self.angle(self.min_angle)

    def max(self):
        """Go to the maximum angle."""
        return self.angle(self.max_angle)

    def sweep(self, start, end, step=1, delay_ms=15):
        """Blocking sweep from `start` to `end` in `step`° increments."""
        step = abs(step) or 1
        rng = range(start, end + 1, step) if end >= start else range(start, end - 1, -step)
        for a in rng:
            self.angle(a)
            time.sleep_ms(delay_ms)

    def ease(self, target, duration_ms=500, steps=30, easing="in_out"):
        """Glide to `target` over `duration_ms` with an easing curve.

        `easing`: "linear", "in" (accelerate), "out" (decelerate), "in_out"
        (smoothstep). Blocking.
        """
        start = self._angle if self._angle is not None else target
        steps = max(1, steps)
        for i in range(steps + 1):
            t = i / steps
            if easing == "in":
                t = t * t
            elif easing == "out":
                t = 1 - (1 - t) * (1 - t)
            elif easing == "in_out":
                t = t * t * (3 - 2 * t)  # smoothstep
            self.angle(start + (target - start) * t)
            time.sleep_ms(duration_ms // steps)

    def detach(self):
        """Stop holding torque (idle) — quells buzz at an end stop."""
        self._pwm.duty_u16(0)

    def deinit(self):
        """Release the PWM peripheral."""
        self._pwm.deinit()
