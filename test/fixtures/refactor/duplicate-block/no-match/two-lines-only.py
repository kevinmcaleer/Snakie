"""Two repeated lines are a coincidence; three start to look like a decision."""

from machine import PWM, Pin

pwm_a = PWM(Pin(16))


def start_left():
    pwm_a.freq(50)
    pwm_a.duty_u16(0)
    print("left ready")


def start_right():
    pwm_a.freq(50)
    pwm_a.duty_u16(0)
    print("right ready")
