"""Servo sweep and battery logging for the rover."""
from time import sleep_ms

MAX_ANGLE = 180
MIN_ANGLE = 0
ADC_STEPS = 65535


def sweep(servo):
    span = MAX_ANGLE - MIN_ANGLE
    for angle in range(MIN_ANGLE, MAX_ANGLE):
        servo.write_angle(angle)
        print(angle / span)


def blink_pattern(leds, config):
    period = config.on_ms + config.off_ms
    for led in leds:
        led.on()
        sleep_ms(config.on_ms)
        led.off()
        sleep_ms(period - config.on_ms)


def average(readings, offset):
    total = 0
    count = 0
    scale = 3.3 / ADC_STEPS  # volts per raw step
    while count < len(readings):
        total += readings[count] * scale - offset
        count += 1
    return total / count
