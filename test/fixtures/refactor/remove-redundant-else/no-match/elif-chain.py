def mode_colour(mode):
    if mode == "run":
        return (0, 255, 0)
    elif mode == "fault":
        return (255, 0, 0)


def axis_step(axis, direction):
    if direction > 0:
        return axis.forward()
    elif direction < 0:
        return axis.back()
