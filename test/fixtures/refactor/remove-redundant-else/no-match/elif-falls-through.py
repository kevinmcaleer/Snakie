def arm_state(rover, mode):
    if mode == "manual":
        rover.blink()
    elif mode == "auto":
        return rover.plan()
    else:
        rover.stop()
        return None
