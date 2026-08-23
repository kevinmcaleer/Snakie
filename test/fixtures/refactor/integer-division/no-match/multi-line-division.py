"""A long average spread over several lines.

The brackets belonging to `int(` are what hold the expression together, so
deleting them would leave a file that no longer parses. The rule declines.
"""

SAMPLE_COUNT = 32


def mean_millivolts(readings):
    return int(
        sum(readings)
        / SAMPLE_COUNT
    )
