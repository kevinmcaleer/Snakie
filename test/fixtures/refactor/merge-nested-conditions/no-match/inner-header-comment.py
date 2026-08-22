def latch(relay, state):
    if relay.ready:
        if state:  # only latch on a rising edge
            relay.close()
            relay.hold(10)
