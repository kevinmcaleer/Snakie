"""A value bound down only one branch cannot be handed back.

Selecting the `if` alone would move the only assignment to `reading` into the
new function, whose `return reading` then raises `UnboundLocalError` whenever
`ready` is false — where the original quietly kept the -1 assigned above. The
rewrite has to prove a returned name is bound on EVERY path through the block.
"""


def log_sample(sensor, ready, log):
    reading = -1
    if ready:
        reading = sensor.read()
    log.write("%d\n" % reading)
