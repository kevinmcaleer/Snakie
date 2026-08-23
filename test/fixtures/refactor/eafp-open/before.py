"""Calibration storage for the rover."""

import os

CALIBRATION = "/calibration.txt"


def load_calibration(path=CALIBRATION):
    if os.path.exists(path):
        with open(path) as f:
            return float(f.read())
    return 1.0


def clear_log(name):
    if os.path.exists(name):
        os.remove(name)
        print("removed", name)
