import time


def poll(sensor):
    readings = 0
    for _ in range(10):
        readings += sensor.read()
        time.sleep(0.1)
    return readings
