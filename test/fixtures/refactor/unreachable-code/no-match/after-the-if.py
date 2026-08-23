"""The early return only ends the `if` body; the rest of the function runs."""


def read_temp(sensor):
    if not sensor.ready:
        return None
    raw = sensor.read()
    return raw / 16


def poll(sensors):
    for sensor in sensors:
        if sensor.failed:
            continue
        yield read_temp(sensor)
