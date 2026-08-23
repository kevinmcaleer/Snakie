"""Servo sweeps and packet flushes for the arm."""

import time


def sweep(servo, steps):
    for i in range(steps):
        servo.angle(i * 2)
        time.sleep_ms(20)


def flush(uart, packets):
    for i in range(packets):
        uart.write(b"\x00")
    uart.flush()


class Arm:
    def home(self):
        for j in range(self.joint_count):
            # Back to the parked position, one joint at a time.
            self.joints[j].move(0)
