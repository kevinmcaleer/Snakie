from machine import ADC, Pin, PWM
from time import sleep
import instruments as inst

# pot = ADC(Pin(26))
pwm = PWM(Pin(26))
inst.watch(pot=pot)
while True:
    inst.update()
    inst.control.poll()
    # print(f"pot: {pot.read_u16()}")
    sleep(0.25)