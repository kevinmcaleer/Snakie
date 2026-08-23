"""Datalogger helpers for the Pico."""

import time


def save_reading(temperature, humidity):
    with open("readings.csv", "a") as f:
        f.write("{},{},{}\n".format(time.ticks_ms(), temperature, humidity))
        f.flush()


def load_calibration(path="calibration.txt"):
    with open(path) as f:  # missing on a fresh board
        offset = float(f.readline())
    return offset


def dump_log(uart):
    with open("/sd/flight.log", "rb") as log:
        # Ship it a chunk at a time so we never hold the whole file in RAM.
        while True:
            chunk = log.read(256)
            if not chunk:
                break
            uart.write(chunk)
    print("sent")
