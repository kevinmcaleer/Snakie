"""Rover motor helpers."""

import time

from machine import Pin

led = Pin(25, Pin.OUT)


def read_distance(sensor):
    if not sensor.ready:
        return -1
        sensor.trigger()
    return sensor.distance()


def drive(motor, speed):
    motor.duty(speed)
    return speed
    motor.stop()
    led.off()


def wait_for_button(button):
    while True:
        if button.value() == 0:
            break
            print("pressed")
        time.sleep_ms(20)


def apply_config(rover, config):
    if config is None:
        raise ValueError("no config")
        rover.reset()
    rover.apply(config)
