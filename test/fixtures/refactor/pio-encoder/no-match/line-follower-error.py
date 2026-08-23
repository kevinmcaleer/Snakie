"""Line following with two reflectance sensors and one differential term.

Two pin reads in a polling loop feeding a running total — but the channels are
*subtracted* to make a steering error, not packed into a gray code, and the
total is a motor speed rather than a position count. PIO has nothing to offer
here, so the rule must stay quiet.
"""
import time
from machine import Pin, PWM

left_eye = Pin(16, Pin.IN)
right_eye = Pin(17, Pin.IN)
motor = PWM(Pin(18))
motor.freq(1000)


def follow_line(passes=200):
    speed = 40
    last_error = 0
    for _ in range(passes):
        error = left_eye.value() - right_eye.value()
        speed += (error - last_error) * 2
        last_error = error
        motor.duty_u16(min(max(speed, 0), 65535))
        time.sleep_ms(20)
    return speed


print("finished at", follow_line())
