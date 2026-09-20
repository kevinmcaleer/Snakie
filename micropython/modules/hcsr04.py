# SPDX-License-Identifier: MIT
"""HC-SR04 ultrasonic range finder driver (Snakie module #120).

A tiny, self-contained MIT-licensed driver for the HC-SR04: pulse the *trigger*
pin high for 10 us, then time the *echo* pulse and convert to a distance. This is
the driver behind the dock **Range** instrument (#112).

Usage on a board::

    from machine import Pin
    from hcsr04 import HCSR04
    import instruments as inst

    sensor = HCSR04(trigger=3, echo=2)
    while True:
        inst.distance(sensor.distance_mm())   # -> Range instrument

`RangeFinder` is a thin alias over the same driver with the positional
`trigger_pin` / `echo_pin` signature and a `distance` *property*, for scripts
written against the standalone `range_finder.py` doing the rounds::

    from hcsr04 import RangeFinder

    sensor = RangeFinder(trigger_pin=0, echo_pin=1)
    print(sensor.distance)     # millimetres
    print(sensor.distance_cm)  # centimetres (a property too, no parens)

The pure conversion (`echo_to_distance_mm`) is split out so it can be unit-tested
under CPython without any `machine` hardware.
"""

# Driver version. Bump this on ANY change to this file — the IDE compares it
# against the copy installed on the board and offers an update when they differ
# (#707; a legacy copy with no `__version__` reads as out-of-date). Keep the
# `__version__ = "X.Y.Z"` literal form so the IDE can parse it without importing.
__version__ = "1.1.0"

# Speed of sound ~= 343 m/s = 0.343 mm/us. The echo pulse covers the round trip
# (out and back), so distance = (pulse_us * 0.343) / 2.
_MM_PER_US = 0.343


def echo_to_distance_mm(pulse_us):
    """Convert a measured echo pulse width (microseconds) to a distance in mm.

    A negative `pulse_us` (the timeout sentinel from `machine.time_pulse_us`)
    yields ``-1`` to signal "out of range / no echo" rather than a bogus value.
    Pure — no hardware needed, so the IDE can unit-test it.
    """
    if pulse_us is None or pulse_us < 0:
        return -1
    return (pulse_us * _MM_PER_US) / 2


class HCSR04:
    """Driver for an HC-SR04 ultrasonic range finder.

    `trigger` / `echo` are pin numbers (or `machine.Pin` objects). `echo_timeout_us`
    bounds the wait so a missing/too-far target returns ``-1`` instead of blocking.
    """

    def __init__(self, trigger, echo, echo_timeout_us=30000):
        # Imported lazily so this module imports cleanly under CPython for tests.
        from machine import Pin

        self._timeout = echo_timeout_us
        self._trigger = trigger if isinstance(trigger, Pin) else Pin(trigger, Pin.OUT)
        self._echo = echo if isinstance(echo, Pin) else Pin(echo, Pin.IN)
        self._trigger.value(0)

    def _pulse_us(self):
        from machine import time_pulse_us
        import time

        # 10 us trigger pulse (datasheet), after a short settle low.
        self._trigger.value(0)
        time.sleep_us(5)
        self._trigger.value(1)
        time.sleep_us(10)
        self._trigger.value(0)
        try:
            return time_pulse_us(self._echo, 1, self._timeout)
        except OSError:
            return -1

    def distance_mm(self):
        """Measure and return the distance in millimetres (``-1`` if no echo)."""
        return echo_to_distance_mm(self._pulse_us())

    def distance_cm(self):
        """Measure and return the distance in centimetres (``-1`` if no echo)."""
        mm = self.distance_mm()
        return -1 if mm < 0 else mm / 10


class RangeFinder(HCSR04):
    """`HCSR04` under the name (and signature) the standalone `range_finder.py` used.

    Same sensor, same maths — it exists so scripts written against that loose
    driver keep working once the module is installed from the Modules manager:
    pin numbers are positional (`trigger_pin` / `echo_pin`), `distance` is a
    PROPERTY, and each read also records `duration` (the echo pulse width, us)
    and `distance_to_object` (mm) as attributes.

    It inherits this module's timing, so an absent or out-of-range target returns
    ``-1`` after `echo_timeout_us` instead of busy-waiting on the echo pin
    forever (the one real bug in the standalone version).
    """

    def __init__(self, trigger_pin=0, echo_pin=1, echo_timeout_us=30000):
        super().__init__(trigger_pin, echo_pin, echo_timeout_us)
        self.duration = -1
        self.distance_to_object = -1

    @property
    def distance(self):
        """Measure and return the distance in MILLIMETRES (``-1`` if no echo).

        Note the unit: the standalone driver's docstring said "cm" but its maths
        (0.343 mm/us) has always produced millimetres, which is why its own
        `distance_cm` divides by ten. Kept as-is so existing scripts read the
        same numbers; use `distance_cm` for centimetres.
        """
        self.duration = self._pulse_us()
        self.distance_to_object = echo_to_distance_mm(self.duration)
        return round(self.distance_to_object, 2)

    @property
    def distance_cm(self):
        """Measure and return the distance in centimetres (``-1`` if no echo).

        A PROPERTY here, unlike `HCSR04.distance_cm()` which is a method — on a
        `RangeFinder` read it as `sensor.distance_cm`, with no call parens.
        """
        mm = self.distance
        return -1 if mm < 0 else round(mm / 10, 1)
