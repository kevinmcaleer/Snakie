"""Snakie Instruments demo — feed the IDE's Oscilloscope / Multimeter / Plotter.

Copy ``micropython/instruments.py`` onto your board (next to ``main.py``), then
paste / run this file. It sets up a PWM channel and an ADC, then loops printing
telemetry the Snakie IDE consumes live — open the instruments and watch them
update while this runs (no LIVE toggle / REPL polling needed).

Wiring (Raspberry Pi Pico):
  * GP0  — PWM output (an LED through a resistor makes the duty visible).
  * GP26 — ADC input (a potentiometer between 3V3 and GND, wiper to GP26).

The PWM duty is swept up and down so the Oscilloscope trace and the Plotter's
``duty`` series move; the ADC voltage drives the Multimeter and the Plotter's
``volts`` series. The loop also emits a synthetic IMU + distance reading and
polls the IDE → board control channel so you can see ``teleop`` / ``led``
commands arrive (issue #115/#116).
"""

import math
import time

from machine import ADC, PWM, Pin

import instruments as inst

# --- Set up hardware --------------------------------------------------------
pwm = PWM(Pin(0))
pwm.freq(1000)
pwm.duty_u16(0)

adc = ADC(26)  # ADC0 on the Pico

# Sweep the PWM duty from 0..65535 and back, one step per loop iteration.
STEP = 4096
duty = 0
direction = STEP
t = 0.0

while True:
    # Move the PWM duty, bouncing at the rails.
    duty += direction
    if duty >= 65535:
        duty = 65535
        direction = -STEP
    elif duty <= 0:
        duty = 0
        direction = STEP
    pwm.duty_u16(duty)

    # Read + emit in one call each: scope sample (duty fraction) and meter (volts).
    duty_frac = inst.read_pwm(pwm, ch="pwm")
    volts = inst.read_adc(adc, ch="adc0")

    # Also push both onto the Plotter as named series so they graph over time.
    inst.plot(duty=round(duty_frac, 3), volts=round(volts, 3))

    # Robotics emitters (#116): a synthetic spinning IMU + a sweeping rangefinder.
    yaw = (t * 90) % 360
    inst.imu(roll=0.0, pitch=round(15 * math.sin(t), 1), yaw=round(yaw, 1))
    inst.distance(round(150 + 100 * math.sin(t)), angle=round(yaw, 1), ch="lidar")

    # Control channel (#115): drain IDE -> board commands, then act on them.
    inst.control.poll()
    axes = inst.control.axes("teleop")            # e.g. {'lx': 0.5, 'ly': -0.2}
    if axes:
        inst.plot(lx=axes.get("lx", 0.0), ly=axes.get("ly", 0.0))

    t += 0.05
    time.sleep(0.05)
