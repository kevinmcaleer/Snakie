# SPDX-License-Identifier: MIT
"""Teleop receiver — gamepad axes -> motor outputs (Snakie module #120).

This is the helper behind the dock **Gamepad** instrument. The IDE writes control
lines (``SNKCMD teleop axes=lx:0.5,ly:-0.2 …``) which the on-device
``instruments.control`` helper parses; this module turns those normalised
``lx``/``ly`` axes into per-wheel drive values for a differential-drive robot.

Usage on a board::

    from machine import Pin, PWM
    from teleop import arcade_mix, TeleopDrive
    import instruments as inst

    drive = TeleopDrive(left=PWM(Pin(16)), right=PWM(Pin(17)))
    while True:
        inst.control.poll()
        ax = inst.control.axes('teleop')          # {'lx':…, 'ly':…}
        drive.apply(ax.get('lx', 0), ax.get('ly', 0))

`arcade_mix` (and `clamp`) are pure and unit-testable under CPython with no PWM.
"""


def clamp(value, lo=-1.0, hi=1.0):
    """Clamp `value` to the inclusive [`lo`, `hi`] range. Pure."""
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


def arcade_mix(throttle, steering):
    """Mix a throttle + steering axis into ``(left, right)`` wheel values. Pure.

    `throttle` (forward/back) and `steering` (turn) are normalised in [-1, 1];
    the result is each wheel's signed power in [-1, 1] (arcade/single-stick
    mixing). This is the whole teleop maths, hardware-free so the IDE can test it.
    """
    throttle = clamp(throttle)
    steering = clamp(steering)
    return clamp(throttle + steering), clamp(throttle - steering)


def _duty_u16(power):
    """Map a signed power [-1, 1] to a 16-bit PWM duty magnitude. Pure helper."""
    return int(round(abs(clamp(power)) * 65535))


class TeleopDrive:
    """Differential-drive mixer that applies gamepad axes to two PWM motors.

    `left` / `right` are `machine.PWM` objects (or anything exposing
    ``duty_u16``). Direction pins are optional; without them only magnitude is
    driven (suitable for a simple ESC / a single-direction test).
    """

    def __init__(self, left, right, left_dir=None, right_dir=None):
        self._left = left
        self._right = right
        self._left_dir = left_dir
        self._right_dir = right_dir

    def apply(self, throttle, steering):
        """Mix and drive both motors from a throttle + steering axis."""
        lp, rp = arcade_mix(throttle, steering)
        self._set(self._left, self._left_dir, lp)
        self._set(self._right, self._right_dir, rp)
        return lp, rp

    @staticmethod
    def _set(motor, dir_pin, power):
        if dir_pin is not None:
            dir_pin.value(1 if power >= 0 else 0)
        motor.duty_u16(_duty_u16(power))

    def stop(self):
        """Cut power to both motors."""
        self._left.duty_u16(0)
        self._right.duty_u16(0)
