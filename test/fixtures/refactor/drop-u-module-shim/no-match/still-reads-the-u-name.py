"""A deadline helper that genuinely uses the `utime` binding.

The `try` branch is the one that runs on the robot, and the code below reads
the name it bound. Collapsing to `import time` would raise NameError.
"""
try:
    import utime
except ImportError:
    import time

DEADLINE_MS = 500


def expired(started_at):
    return utime.ticks_diff(utime.ticks_ms(), started_at) > DEADLINE_MS
