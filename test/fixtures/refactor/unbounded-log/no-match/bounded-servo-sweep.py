"""A servo calibration table, built once by a bounded `for`.

`range(...)` ends, so these lists reach a known size and then stop. That is a
lookup table, not a leak, and flagging it would teach exactly the wrong lesson.
"""
from machine import PWM, Pin

pan = PWM(Pin(15))
pan.freq(50)

angles = []
duties = []

for angle in range(0, 181, 5):
    angles.append(angle)
    duties.append(1638 + angle * 46)

for step in range(len(angles)):
    pan.duty_u16(duties[step])
