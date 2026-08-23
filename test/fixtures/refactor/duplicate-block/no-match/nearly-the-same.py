"""The two blocks drive different pins — they only look alike from a distance."""

from machine import PWM, Pin

pwm_a = PWM(Pin(16))
pwm_b = PWM(Pin(17))
pin_a = Pin(18, Pin.OUT)
pin_b = Pin(19, Pin.OUT)


def start_left():
    pwm_a.freq(50)
    pwm_a.duty_u16(0)
    pin_a.value(0)
    print("left ready")


def start_right():
    pwm_b.freq(50)
    pwm_b.duty_u16(0)
    pin_b.value(0)
    print("right ready")
