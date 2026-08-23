"""Two reads of a live sensor are two readings, not one value with two names."""


def log_pressure(sensor):
    print(sensor.read_u16() * 3300 // 65535)
    store(sensor.read_u16() * 3300 // 65535)
