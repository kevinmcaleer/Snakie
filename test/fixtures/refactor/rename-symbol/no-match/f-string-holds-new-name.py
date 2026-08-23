# The f-string is opaque to the parser, so the `battery_v` it interpolates is
# invisible to the reference set. Today it reads the module constant; rename
# `batteryV` to `battery_v` and it would quietly start reading the new local
# instead, and the pack would report its own measurement as the nominal figure.
battery_v = 3.7


def log_pack(cells):
    batteryV = sum(cells)
    print(f"nominal {battery_v} V")
    return batteryV
