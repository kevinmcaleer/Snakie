"""Snakie Instruments — emit live readings to the Snakie IDE's instruments.

Copy this file onto your MicroPython board (a Pico, etc.) and ``import`` it.
Instead of the IDE polling the board over the raw REPL (which interrupts a
running program), your program *prints* readings with these helpers and the
IDE *parses the serial stream* — so it works non-invasively, even inside a
tight ``while True:`` loop.

Quick start
-----------

::

    import time
    from machine import ADC, PWM, Pin
    import instruments as inst

    pwm = PWM(Pin(0)); pwm.freq(1000); pwm.duty_u16(32768)
    adc = ADC(26)

    while True:
        inst.read_pwm(pwm, ch="pwm")     # -> Oscilloscope
        inst.read_adc(adc, ch="adc0")    # -> Multimeter
        inst.plot(temp=21.4, light=80)   # -> Plotter
        time.sleep(0.1)

API
---

``scope(value, ch="ch1")``
    Emit one oscilloscope sample for channel ``ch`` (call it repeatedly in a
    loop to draw a live waveform).
``meter(value, ch="adc0", unit="V")``
    Emit one multimeter reading for channel ``ch`` (the latest value is shown;
    the IDE tracks MIN/MAX/AVG).
``plot(*args, **kwargs)``
    Emit one plotter row — bare numbers (``plot(1, 2, 3)``) and/or named
    series (``plot(temp=21.4, light=80)``).
``read_adc(adc, ch="adc0")``
    Read ``adc.read_u16()``, convert to volts (3.3 V ref, 16-bit), ``meter`` it,
    and return the volts.
``read_pwm(pwm, ch="pwm")``
    Read ``pwm.duty_u16() / 65535``, ``scope`` it, and return the duty fraction.

The telemetry protocol
----------------------

Each helper does a single ``print()`` of ONE line, prefixed with the sentinel
token ``SNK`` so the IDE can route the line to the right instrument and hide it
from the console (and so the Plotter's generic parser ignores it). One reading
per line, ASCII, space-delimited::

    SNK SCOPE <ch> <value>
    SNK METER <ch> <value> [<unit>]
    SNK PLOT <tok> [<tok> ...]      # each <tok> is name=value or a bare number

``<ch>`` is a user label (e.g. ``pwm``, ``adc0``, a variable name) the IDE uses
to match a reading to an open instrument.

The helpers are pure ``print`` + ``str`` formatting (no allocation-heavy work,
no blocking), so they are safe to call at speed inside a loop. The convenience
``read_*`` helpers are the only ones that touch hardware.
"""

# The sentinel that prefixes every telemetry line. Kept short + ASCII so it is
# cheap to print and easy for the IDE to detect / strip.
SENTINEL = "SNK"


def scope(value, ch="ch1"):
    """Emit one oscilloscope sample ``value`` for channel ``ch``.

    Prints ``SNK SCOPE <ch> <value>``. Call repeatedly in a loop to feed a live
    waveform to an open Oscilloscope whose source matches ``ch``.
    """
    print("%s SCOPE %s %s" % (SENTINEL, ch, value))


def meter(value, ch="adc0", unit="V"):
    """Emit one multimeter reading ``value`` (with ``unit``) for channel ``ch``.

    Prints ``SNK METER <ch> <value> <unit>``. The IDE shows the latest value and
    folds it into the meter's MIN/MAX/AVG.
    """
    print("%s METER %s %s %s" % (SENTINEL, ch, value, unit))


def plot(*args, **kwargs):
    """Emit one plotter row of bare numbers and/or named series.

    ``plot(1, 2, 3)`` prints ``SNK PLOT 1 2 3``; ``plot(temp=21.4, light=80)``
    prints ``SNK PLOT temp=21.4 light=80``; the two styles can be mixed. Each
    token uses the Plotter's own ``name=value`` / bare-number grammar.
    """
    toks = [str(a) for a in args]
    # `kwargs` preserves insertion order on MicroPython + CPython 3.7+, so the
    # series appear in the order the caller named them.
    for name, val in kwargs.items():
        toks.append("%s=%s" % (name, val))
    print("%s PLOT %s" % (SENTINEL, " ".join(toks)))


def read_adc(adc, ch="adc0"):
    """Read ``adc`` (a ``machine.ADC``), emit a meter reading, and return volts.

    Converts the 16-bit ``read_u16()`` count to volts against a 3.3 V reference,
    ``meter``s it on channel ``ch`` (unit ``V``), and returns the volts so the
    caller can also use the value.
    """
    volts = adc.read_u16() / 65535 * 3.3
    meter(volts, ch=ch, unit="V")
    return volts


def read_pwm(pwm, ch="pwm"):
    """Read ``pwm`` (a ``machine.PWM``), emit a scope sample, and return the duty.

    Reads ``duty_u16()`` as a 0..1 fraction (``/ 65535``), ``scope``s it on
    channel ``ch``, and returns the duty fraction.
    """
    duty = pwm.duty_u16() / 65535
    scope(duty, ch=ch)
    return duty
