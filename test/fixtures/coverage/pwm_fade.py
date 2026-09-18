# buckets: method call on an object, augmented assign, for/range
from machine import Pin, PWM
import time

pwm = PWM(Pin(16))
pwm.freq(1000)

duty = 0
for step in range(64):
    duty += 1024
    pwm.duty_u16(duty)
    time.sleep_ms(10)

pwm.deinit()
