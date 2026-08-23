"""A value only a loop binds is not a value the block can hand back.

Selecting the `for` would leave the new function ending in `return reading`,
which raises `UnboundLocalError` when `sensors` is empty — and there is no
earlier binding to pass in either, so the rule declines rather than moving the
crash. (Where the caller *has* bound the name, it travels in as a parameter and
the extraction is safe; that is the `if`-with-no-`else` case.)
"""


def log_last(sensors, log):
    for sensor in sensors:
        reading = sensor.read()
    log.write("%d\n" % reading)
