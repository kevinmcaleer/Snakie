"""`while i < len(queue)` re-reads the length every pass; `range` reads it once."""


def drain(queue):
    i = 0
    while i < len(queue):
        queue[i].handle()
        i += 1


def poll(bus):
    i = 0
    while i < bus.device_count():
        bus.read(i)
        i += 1
