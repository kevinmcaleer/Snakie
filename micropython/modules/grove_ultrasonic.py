# SPDX-License-Identifier: MIT
"""Grove Ultrasonic Ranger driver (Snakie module #120).

A small, self-contained MIT-licensed driver for Seeed's **Grove Ultrasonic
Ranger**, another driver behind the dock **Range** instrument (#112).

Unlike the HC-SR04 (see `hcsr04.py`), this module has **one signal wire that is
both trigger and echo**. The pin is driven as an output to send the burst, then
immediately flipped to an input to time the return. That single-pin dance is the
whole difference, and it is why the HC-SR04 driver cannot be pointed at one:
`HCSR04(trigger=p, echo=p)` fights itself over the pin direction.

Usage on a board::

    from grove_ultrasonic import GroveUltrasonic
    import instruments as inst

    sensor = GroveUltrasonic(0)          # a single Grove digital pin
    while True:
        inst.distance(sensor.distance_mm())   # -> Range instrument

The conversion (`echo_to_distance_mm`) is pure, so it can be unit-tested under
CPython without hardware.
"""

# Speed of sound ~= 343 m/s = 0.343 mm/us. The echo covers the round trip (out
# and back), so distance = (pulse_us * 0.343) / 2.
_MM_PER_US = 0.343

#: ~30 ms bounds the wait at roughly 5 m, past this sensor's useful range.
DEFAULT_TIMEOUT_US = 30000


def echo_to_distance_mm(pulse_us):
    """Convert a measured echo pulse width (microseconds) to a distance in mm.

    A negative `pulse_us` (the timeout sentinel from `machine.time_pulse_us`)
    yields ``-1`` to signal "out of range / no echo" rather than a bogus value.
    Pure — no hardware needed, so the IDE can unit-test it.
    """
    if pulse_us is None or pulse_us < 0:
        return -1
    return (pulse_us * _MM_PER_US) / 2


class GroveUltrasonic:
    """Driver for a Grove Ultrasonic Ranger on a single digital pin.

    `pin` is a pin number (or a `machine.Pin` object — its direction is
    reconfigured on every reading, which is inherent to the one-wire design).
    """

    def __init__(self, pin, echo_timeout_us=DEFAULT_TIMEOUT_US):
        # Imported lazily so this module imports cleanly under CPython for tests.
        from machine import Pin

        self._timeout = echo_timeout_us
        # Keep the pin NUMBER: the direction is re-set per reading, so we
        # re-make the Pin each time rather than hold one fixed mode.
        self._pin = pin.id() if hasattr(pin, "id") else pin

    def _pulse_us(self):
        from machine import Pin, time_pulse_us
        import time

        # Trigger: a clean low, then a 10 us high burst, on the pin as OUTPUT.
        trig = Pin(self._pin, Pin.OUT)
        trig.value(0)
        time.sleep_us(2)
        trig.value(1)
        time.sleep_us(10)
        trig.value(0)
        # Now hand the SAME pin over to the echo measurement as an input.
        echo = Pin(self._pin, Pin.IN)
        try:
            return time_pulse_us(echo, 1, self._timeout)
        except OSError:
            return -1

    def distance_mm(self):
        """Measure and return the distance in millimetres (``-1`` if no echo)."""
        return echo_to_distance_mm(self._pulse_us())

    def distance_cm(self):
        """Measure and return the distance in centimetres (``-1`` if no echo)."""
        mm = self.distance_mm()
        return -1 if mm < 0 else mm / 10
