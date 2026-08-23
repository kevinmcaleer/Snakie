#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# A turret sweep with no docstring and no imports, so the definitions go above
# the first statement. They must still land UNDER these two header lines: a
# constant wedged above the shebang stops the file being executable at all, and
# a coding cookie only counts on the first two lines.
def set_pulse(servo, pulse):
    servo.duty_ns(pulse * 1000)


def centre(pan, tilt):
    set_pulse(pan, 1500)
    set_pulse(tilt, 1500)
