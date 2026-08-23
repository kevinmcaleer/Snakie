"""Status display and drive helpers for the rover."""


def draw_status(display, battery, verbose=True):
    if verbose:
        display.text("battery {}%".format(battery), 0, 0)
        display.text("mode: manual", 0, 10)
    else:
        display.text("{}%".format(battery), 0, 0)
    display.show()


def travel(motors, distance, reverse=False):
    if reverse:
        motors.run(-distance)
    else:
        motors.run(distance)
    motors.stop()
