"""Sample buffering for the datalogger."""

import time


class Logger:
    def __init__(self, sink):
        self.sink = sink
        self.samples = []
        self.faults = []

    def flush(self):
        if self.samples:
            self.sink.write(self.samples)
            self.samples = []

    def wait_for_data(self):
        while not self.samples:
            time.sleep_ms(10)

    def status(self):
        if self.faults and self.samples:
            return "degraded"
        assert not self.samples or self.sink is not None
        return "ok"

    def count(self):
        # Not a condition — the comparison's own value is what gets returned.
        return len(self.samples) > 0


def tagged(rows):
    return [r for r in rows if r.tags]
