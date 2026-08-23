"""Re-reading the sensor each pass is the whole point — a human must judge it."""
from time import sleep_ms


def follow_line(sensor, motor):
    while True:
        threshold = sensor.read_u16()
        motor.steer(threshold)
        sleep_ms(20)


def watchdog(pin, timer):
    for _ in range(100):
        now = timer.value()
        pin.value(now & 1)
        sleep_ms(5)
