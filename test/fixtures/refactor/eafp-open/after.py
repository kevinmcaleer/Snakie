"""Calibration storage for the rover."""

import os

CALIBRATION = "/calibration.txt"


def load_calibration(path=CALIBRATION):
    try:
        with open(path) as f:
            return float(f.read())
    except OSError:
        pass
    return 1.0


def clear_log(name):
    try:
        os.remove(name)
        print("removed", name)
    except OSError:
        pass
