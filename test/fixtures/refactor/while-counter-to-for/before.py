"""Servo sweeps and packet flushes for the arm."""

import time


def sweep(servo, steps):
    i = 0
    while i < steps:
        servo.angle(i * 2)
        time.sleep_ms(20)
        i += 1


def flush(uart, packets):
    i = 0
    while i < packets:
        uart.write(b"\x00")
        i += 1
    uart.flush()


class Arm:
    def home(self):
        j = 0
        while j < self.joint_count:
            # Back to the parked position, one joint at a time.
            self.joints[j].move(0)
            j += 1
