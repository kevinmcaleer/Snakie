"""An `except` body sits at the same indent as its `try` body, not one deeper."""


def refresh(display, sensors):
    for sensor in sensors:
        if sensor.enabled:
            try:
                display.show(sensor.read())
            except OSError:
                display.show("--")
