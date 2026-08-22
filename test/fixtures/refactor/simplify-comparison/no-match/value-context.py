"""The comparison's value is kept, so `== True` may not become the value."""


def snapshot(rover, telemetry):
    # A bool is stored, sent and returned — swapping in the raw flag would put a
    # duty cycle where the receiver expects True/False.
    telemetry["armed"] = rover.armed == True
    telemetry["stalled"] = rover.stalled != False
    rover.send(rover.charging == False)
    return rover.docked != True


def defaults(mode):
    return {"reverse": mode == False, "brake": mode != True}
