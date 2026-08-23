"""One generated line would run well past 100 columns.

Choosing which fields to drop is the author's call, not the tool's, so the rule
says nothing rather than writing a line nobody can read on a serial console.
"""


class TelemetryFrame:
    def __init__(self, timestamp_ms, battery_millivolts, heading_degrees, distance_mm):
        self.timestamp_ms = timestamp_ms
        self.battery_millivolts = battery_millivolts
        self.heading_degrees = heading_degrees
        self.distance_mm = distance_mm
