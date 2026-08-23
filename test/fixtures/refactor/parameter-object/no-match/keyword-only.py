"""Keyword-only arguments arrive at the call site already labelled.

`publish(topic, payload, qos=1, retain=True, timeout_ms=500, tries=2)` names
every value it passes, which is the thing a parameter object would have been
introduced to achieve. Whether the `*` came on its own or as `*samples` makes no
difference: everything after it must be written with its name.
"""


def publish(topic, payload, *, qos=0, retain=False, timeout_ms=1000, tries=3):
    print(topic, payload, qos, retain, timeout_ms, tries)


def calibrate(name, *samples, low, high, step, dwell, tag):
    print(name, samples, low, high, step, dwell, tag)
