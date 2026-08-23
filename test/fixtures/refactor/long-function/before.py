"""One long start-up routine for the two-wheeled rover.

The rule offers no rewrite — `before.py` and `after.py` are identical on
purpose. What it reports is the length and where the author's own seams are.
"""

from machine import ADC, I2C, PWM, Pin
from time import sleep_ms

LEFT_PWM = 16
RIGHT_PWM = 17
TRIGGER = 14
ECHO = 15
BATTERY = 26
I2C_SDA = 4
I2C_SCL = 5


def bring_up_rover(config):
    # ---- motors ----
    left = PWM(Pin(LEFT_PWM))
    right = PWM(Pin(RIGHT_PWM))
    left.freq(config["pwm_hz"])
    right.freq(config["pwm_hz"])
    left.duty_u16(0)
    right.duty_u16(0)
    sleep_ms(50)

    # ---- distance sensor ----
    trigger = Pin(TRIGGER, Pin.OUT)
    echo = Pin(ECHO, Pin.IN)
    trigger.value(0)
    sleep_ms(2)
    trigger.value(1)
    sleep_ms(1)
    trigger.value(0)
    if echo.value():
        print("echo pin stuck high, check the wiring")

    # ---- battery monitor ----
    battery = ADC(Pin(BATTERY))
    raw = battery.read_u16()
    volts = raw * 3.3 / 65535 * config["divider"]
    if volts < config["low_volts"]:
        print("battery low:", volts)
    else:
        print("battery ok:", volts)

    # ---- i2c bus ----
    bus = I2C(0, sda=Pin(I2C_SDA), scl=Pin(I2C_SCL), freq=400000)
    found = bus.scan()
    for address in found:
        print("i2c device at", hex(address))
    if not found:
        print("no i2c devices — is the display plugged in?")

    # ---- hand it all back ----
    return {
        "left": left,
        "right": right,
        "trigger": trigger,
        "echo": echo,
        "battery": battery,
        "bus": bus,
    }
