def pulse(pin, ticks):
    if pin is not None:
        if ticks > 0: pin.toggle()


def hold(relay, state):
    if relay.ready:
        if state: relay.close(); relay.hold(10)
