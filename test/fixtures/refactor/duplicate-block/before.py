"""Motor start-up, copied and pasted three times.

The rule offers no rewrite — `before.py` and `after.py` are identical on
purpose. What it reports is that the same three lines appear three times.
"""

from machine import PWM, Pin

pwm_a = PWM(Pin(16))
pin_a = Pin(18, Pin.OUT)


def start_left():
    pwm_a.freq(50)
    pwm_a.duty_u16(0)
    pin_a.value(0)
    print("left ready")


def start_right():
    pwm_a.freq(50)
    pwm_a.duty_u16(0)
    pin_a.value(0)
    print("right ready")


def reset_all(force):
    if force:
        pwm_a.freq(50)
        pwm_a.duty_u16(0)
        pin_a.value(0)
    return force
