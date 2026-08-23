"""Sampling loops for the rover's line sensors."""

SKIP = (0x00, 0x7F)


def count_hits(samples, threshold):
    count = 0
    for reading in samples:
        if reading <= threshold:
            continue
        count += 1
        log(reading)
    return count


def poll(sensors):
    while True:
        if not sensors.ready():
            continue
        # Drain the FIFO before the next conversion starts.
        values = sensors.read_all()
        publish(values)


def scan(bus, addresses):
    for addr in addresses:
        if not (bus.probe(addr) and addr not in SKIP):
            continue
        device = bus.open(addr)
        device.reset()
        device.close()


def wait_for_edge(pin, deadline):
    while ticks_ms() < deadline:
        if pin.value() != 1 or pin.armed:
            continue
        pin.armed = True
        handle_edge(pin)
