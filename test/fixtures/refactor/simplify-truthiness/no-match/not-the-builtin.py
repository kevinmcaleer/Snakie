"""Calls that only look like `len(xs)`."""


def drain(bus, queue):
    # A method on the driver, not the built-in.
    if bus.len(queue) > 0:
        bus.pump()
    # Somebody else's helper.
    if size(queue) > 0:
        bus.pump()
    # A count that has nothing to do with a container's truthiness.
    if len(queue, 2) > 0:
        bus.pump()
