"""Inside a `try`, a half-finished block still leaves its earlier writes behind.

`temperature` is assigned before `bus.read()` can fail, so the handler sees it.
A call that raised would assign nothing at all, so rule 8 declines here.
"""


def read_climate(bus, log):
    temperature = -1
    humidity = -1
    try:
        temperature = bus.read(0x40)
        humidity = bus.read(0x41)
    except OSError:
        log.write("bus error\n")
    return temperature, humidity
