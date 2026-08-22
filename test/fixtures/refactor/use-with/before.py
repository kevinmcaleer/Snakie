"""Datalogger helpers for the Pico."""

import time


def save_reading(temperature, humidity):
    f = open("readings.csv", "a")
    f.write("{},{},{}\n".format(time.ticks_ms(), temperature, humidity))
    f.flush()
    f.close()


def load_calibration(path="calibration.txt"):
    f = open(path)  # missing on a fresh board
    try:
        offset = float(f.readline())
    finally:
        f.close()
    return offset


def dump_log(uart):
    log = open("/sd/flight.log", "rb")
    # Ship it a chunk at a time so we never hold the whole file in RAM.
    while True:
        chunk = log.read(256)
        if not chunk:
            break
        uart.write(chunk)
    log.close()
    print("sent")
