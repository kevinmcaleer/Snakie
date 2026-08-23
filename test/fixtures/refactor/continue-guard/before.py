"""Sampling loops for the rover's line sensors."""

SKIP = (0x00, 0x7F)


def count_hits(samples, threshold):
    count = 0
    for reading in samples:
        if reading > threshold:
            count += 1
            log(reading)
    return count


def poll(sensors):
    while True:
        if sensors.ready():
            # Drain the FIFO before the next conversion starts.
            values = sensors.read_all()
            publish(values)


def scan(bus, addresses):
    for addr in addresses:
        if bus.probe(addr) and addr not in SKIP:
            device = bus.open(addr)
            device.reset()
            device.close()


def wait_for_edge(pin, deadline):
    while ticks_ms() < deadline:
        if pin.value() == 1 and not pin.armed:
            pin.armed = True
            handle_edge(pin)
