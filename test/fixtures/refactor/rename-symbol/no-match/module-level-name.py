# A camelCase name bound at module scope is this file's public surface: another
# module may say `from cruise import motorSpeed`, and the REPL may poke it by
# name. Neither is visible from here, so the rename is not ours to make.
from machine import Pin

motorSpeed = 40
statusLed = Pin(25, Pin.OUT)


def cruise(motor):
    motor.duty_u16(motorSpeed)
    statusLed.on()
