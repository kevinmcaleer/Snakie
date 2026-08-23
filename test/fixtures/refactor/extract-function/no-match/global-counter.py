"""A `global` declaration binds a name the new function would not reach."""

STALLS = 0


def note_stall(motor, log):
    global STALLS
    STALLS += 1
    log.write("stall %d\n" % STALLS)
    motor.stop()
