"""Servo sweep and an ultrasonic ping, written against plain uasyncio."""
import uasyncio
from utime import sleep_ms as delay
from machine import PWM, Pin

servo = PWM(Pin(15))
servo.freq(50)
trigger = Pin(3, Pin.OUT)


async def sweep(low=1600, high=8000, step=200):
    for duty in range(low, high, step):
        servo.duty_u16(duty)
        delay(20)
    servo.duty_u16((low + high) // 2)


async def ping():
    while True:
        trigger.value(1)
        delay(1)
        trigger.value(0)
        delay(50)


class Head:
    async def nod(self, times=3):
        for _ in range(times):
            servo.duty_u16(2000)
            delay(300)
            servo.duty_u16(6000)
            delay(300)

    def park(self):
        servo.duty_u16(4800)
        delay(300)
