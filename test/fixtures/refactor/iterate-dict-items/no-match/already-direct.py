"""Both loops are already in their final shape."""


def stop_all(servos):
    for name in servos:
        servos[name].detach()


def wake_all(servos):
    for name, servo in servos.items():
        servo.attach()
