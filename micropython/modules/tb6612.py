# SPDX-License-Identifier: MIT
"""Grove I²C Motor Driver (TB6612FNG) driver (Snakie module #120).

A small, self-contained MIT-licensed driver for Seeed's **Grove - I²C Motor
Driver (TB6612FNG)** — two DC motor channels commanded over I²C.

Careful, there are two different Grove motor drivers:

* This one (SKU 105020001) has an on-board MCU, ships on **0x14**, and takes
  single-byte *commands* (``[cmd, channel, speed]``).
* The older **Grove I²C Motor Driver V1.x** is a different board on **0x0F**
  with a different protocol (``0x82`` speed-set, ``0xAA`` direction-set). This
  driver will not drive it.

Usage on a board::

    from machine import I2C, Pin
    from tb6612 import GroveMotorDriver, CH_A, CH_B

    m = GroveMotorDriver(I2C(1, sda=Pin(6), scl=Pin(7)))
    m.wake()                # leave standby before anything will turn
    m.run(CH_A, 200)        # forward, 0..255
    m.run(CH_B, -200)       # reverse
    m.brake(CH_A)           # short the windings (active stop)
    m.stop(CH_B)            # coast

Both motors off is `stop`/`brake` per channel; `standby()` disables the H-bridge
outputs entirely and is the safe state to leave the robot in.

The frame builders (`run_frame`, `brake_frame`, …) are pure and return the exact
bytes put on the wire, so the command encoding is unit-testable under CPython
without an I²C bus.
"""

# --- Protocol ----------------------------------------------------------------
# Commands, verified against Seeed's Grove_Motor_Driver_TB6612FNG library.
# Every frame is [command, arg...] written to the device address.
_CMD_BRAKE = 0x00
_CMD_STOP = 0x01
_CMD_CW = 0x02
_CMD_CCW = 0x03
_CMD_STANDBY = 0x04
_CMD_NOT_STANDBY = 0x05
_CMD_SET_ADDR = 0x11

DEFAULT_ADDR = 0x14

#: Motor channel ids, as the board numbers them.
CH_A = 0
CH_B = 1

#: Max magnitude of a speed value (8-bit PWM).
MAX_SPEED = 255


def run_frame(channel, speed):
    """Bytes for "drive `channel` at `speed`". Pure.

    `speed` is -255..255; the sign picks the direction command (``0x02`` CW /
    ``0x03`` CCW) and the magnitude is sent as the PWM value. Out-of-range
    speeds are clamped rather than rejected, matching the vendor library.
    """
    if speed > MAX_SPEED:
        speed = MAX_SPEED
    elif speed < -MAX_SPEED:
        speed = -MAX_SPEED
    cmd = _CMD_CW if speed >= 0 else _CMD_CCW
    return bytes([cmd, channel, abs(speed)])


def power_to_speed(power):
    """Map a signed power in [-1.0, 1.0] to a -255..255 speed. Pure.

    This is the seam with `teleop.arcade_mix`, which speaks in normalised wheel
    powers — so a gamepad can drive this board without either module knowing
    about the other's units.
    """
    if power > 1.0:
        power = 1.0
    elif power < -1.0:
        power = -1.0
    return int(round(power * MAX_SPEED))


def brake_frame(channel):
    """Bytes for "brake `channel`" — an active stop, windings shorted. Pure."""
    return bytes([_CMD_BRAKE, channel])


def stop_frame(channel):
    """Bytes for "stop `channel`" — outputs released, the motor coasts. Pure."""
    return bytes([_CMD_STOP, channel])


def standby_frame(on=True):
    """Bytes for entering (`on`) or leaving standby. Pure."""
    return bytes([_CMD_STANDBY if on else _CMD_NOT_STANDBY, 0x00])


def set_addr_frame(addr):
    """Bytes for permanently re-addressing the board. Pure.

    Valid addresses are ``0x01``..``0x7F``; the change persists across power
    cycles, so the board will no longer answer on its old address.
    """
    if not 0x00 < addr < 0x80:
        raise ValueError("I2C address out of range: 0x%02x" % addr)
    return bytes([_CMD_SET_ADDR, addr])


class GroveMotorDriver:
    """Driver for a Grove I²C Motor Driver (TB6612FNG) on an I²C bus."""

    def __init__(self, i2c, addr=DEFAULT_ADDR):
        self._i2c = i2c
        self._addr = addr

    @property
    def addr(self):
        """The I²C address this instance is talking to."""
        return self._addr

    def _send(self, frame):
        from time import sleep_ms

        self._i2c.writeto(self._addr, frame)
        # The board's firmware needs a moment between commands; the vendor
        # library delays 1 ms after every one.
        sleep_ms(1)

    def run(self, channel, speed):
        """Drive `channel` (`CH_A`/`CH_B`) at `speed`, -255..255."""
        self._send(run_frame(channel, speed))

    def brake(self, channel):
        """Actively brake `channel` (shorts the windings)."""
        self._send(brake_frame(channel))

    def stop(self, channel):
        """Release `channel`'s outputs so the motor coasts."""
        self._send(stop_frame(channel))

    def stop_all(self):
        """Coast both motors — the usual "end of move" state."""
        self.stop(CH_A)
        self.stop(CH_B)

    def drive(self, left_power, right_power):
        """Apply signed powers in [-1, 1] to channel A (left) and B (right).

        Pairs directly with `teleop.arcade_mix`::

            drive.drive(*arcade_mix(lx, ly))
        """
        self.run(CH_A, power_to_speed(left_power))
        self.run(CH_B, power_to_speed(right_power))

    def standby(self):
        """Disable both H-bridges. The safe state to leave the robot in."""
        self._send(standby_frame(True))

    def wake(self):
        """Leave standby. Nothing will turn until this has been called."""
        self._send(standby_frame(False))

    def set_address(self, addr):
        """PERMANENTLY re-address the board (persists across power cycles)."""
        from time import sleep_ms

        self._i2c.writeto(self._addr, set_addr_frame(addr))
        self._addr = addr
        sleep_ms(100)
