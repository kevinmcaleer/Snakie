"""Telemetry logging for the rover's wheel sensors."""

import time

LIMIT = 900


def log_run(readings, log):
    for reading in readings:
        if reading.valid:
            for sample in reading.samples:
                if sample > LIMIT:
                    log.write("%d\n" % sample)
                    log.flush()


def patrol(rover, waypoints, radio):
    while rover.armed:
        for waypoint in waypoints:
            with rover.claim_motors() as motors:
                try:
                    motors.drive_to(waypoint)
                except OSError:
                    radio.send(b"stalled")
        time.sleep_ms(50)
