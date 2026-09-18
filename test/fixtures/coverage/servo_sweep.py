# buckets: early return, method call on an object, trailing comment
from machine import Pin, PWM

servo = PWM(Pin(0))
servo.freq(50)


def angle(degrees):
    if degrees < 0:
        return
    if degrees > 180:
        return
    duty = 1638 + int(degrees * 6553 / 180)  # 0.5ms .. 2.5ms
    servo.duty_u16(duty)


angle(90)
