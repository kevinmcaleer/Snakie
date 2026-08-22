"""Sample buffering for the datalogger."""

import time


class Logger:
    def __init__(self, sink):
        self.sink = sink
        self.samples = []
        self.faults = []

    def flush(self):
        if len(self.samples) > 0:
            self.sink.write(self.samples)
            self.samples = []

    def wait_for_data(self):
        while len(self.samples) == 0:
            time.sleep_ms(10)

    def status(self):
        if len(self.faults) >= 1 and len(self.samples) != 0:
            return "degraded"
        assert len(self.samples) < 1 or self.sink is not None
        return "ok"

    def count(self):
        # Not a condition — the comparison's own value is what gets returned.
        return len(self.samples) > 0


def tagged(rows):
    return [r for r in rows if len(r.tags) > 0]
