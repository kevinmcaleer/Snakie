from machine import PWM
import instruments as inst
import time

servo = PWM(0)
inst.start(servo_pin=0)

while True:
    inst.control.poll()
    time.sleep(0.02)
