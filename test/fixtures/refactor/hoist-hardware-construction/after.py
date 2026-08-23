"""Status LED, drive motor and potentiometer helpers for the rover."""

from machine import ADC, Pin, PWM
from time import sleep_ms

LED_PIN = 25
POT_PIN = 26


def blink(count):
    led = Pin(LED_PIN, Pin.OUT)
    for _ in range(count):
        led.value(1)
        sleep_ms(50)
        led.value(0)
        sleep_ms(50)


def ramp_up(top_speed):
    speed = 0
    throttle = PWM(Pin(15))  # rear drive motor
    while speed < top_speed:
        throttle.freq(1000)
        throttle.duty_u16(speed)
        speed += 256


def average_pot(samples):
    total = 0
    pot = ADC(Pin(POT_PIN))
    for _ in range(samples):
        total += pot.read_u16()
        sleep_ms(2)
    return total // samples
