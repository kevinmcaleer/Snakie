# buckets: method call on an object, f-string, dict subscript, with, trailing comment
import time

import ujson


def sample(sensors):
    out = {}
    for name in sensors:
        out[name] = sensors[name].read()
    return out


def store(path, reading):
    with open(path, "a") as handle:
        handle.write(ujson.dumps(reading))
        handle.write("\n")


def run(sensors, path, every):
    while True:
        reading = sample(sensors)
        store(path, reading)
        print(f"logged {len(reading)} sensors")  # one line per sample
        time.sleep(every)
