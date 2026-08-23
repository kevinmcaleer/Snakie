def drain(pack, load):
    if pack.voltage > 3.3:
        if load.enabled:
            load.draw(50)
            load.log()
    else:
        load.stop()


def report(link, reading):
    if link.connected:
        if reading > 0:
            link.send(reading)
            link.flush()
        else:
            link.send(0)
