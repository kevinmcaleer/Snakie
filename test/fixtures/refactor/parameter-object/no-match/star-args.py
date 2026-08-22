"""A `*args`/`**kwargs` tail is one idea, however many values it carries."""

import time


def broadcast(topic, *payloads, retain=False, **headers):
    for payload in payloads:
        print(topic, payload, retain, headers)


def log_telemetry(*readings, **tags):
    stamp = time.ticks_ms()
    for reading in readings:
        print(stamp, reading, tags)
