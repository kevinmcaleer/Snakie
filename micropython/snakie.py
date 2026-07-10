"""snakie — the friendly hardware layer for Snakie sketches.

Import the things you *drive* from here, so your code reads
``pin -> PWM -> Servo -> joint`` and never clashes with a vendor ``servo``
module (Pimoroni's frozen ``servo``, etc.)::

    from snakie import Servo, Buzzer, Led, Pin, PWM

    base = Servo(PWM(Pin(0)), pin=0)   # a servo on GP0; pin= drives the 3-D model
    base.angle(90)

These are re-exported from Snakie's on-device runtime (``instruments``), which
keeps the *measurement* tools (scope / meter / plotter). Same classes, friendlier
name — ``snakie.Servo`` *is* ``instruments.Servo``. Uploaded to ``/lib/snakie.py``
alongside ``instruments.py`` by the Board View's library installer.
"""

# Re-export ONLY the hardware/actuator classes + raw IO — the "connect pins to
# things" layer. Scopes/meters/plotters stay in `instruments` (they're not things
# you wire up, they're how you observe the ones you do).
from instruments import Servo, Buzzer, Led, Pin, PWM  # noqa: F401 - re-exported API

__all__ = ["Servo", "Buzzer", "Led", "Pin", "PWM"]
