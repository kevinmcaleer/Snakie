"""Control loop and sensor sweep for the balancing robot."""

from machine import ADC, Pin
from time import sleep_ms

DEBUG = False
line_sensor = ADC(Pin(26))


def balance(imu, motors):
    while True:
        angle = imu.read_angle()
        print("angle", angle)
        motors.drive(angle * 4)
        sleep_ms(20)


def sweep(samples):
    total = 0
    for i in range(samples):
        value = line_sensor.read_u16()
        print(i, value)
        total += value
    return total // samples
