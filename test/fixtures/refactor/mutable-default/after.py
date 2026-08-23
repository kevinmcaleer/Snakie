"""Waypoint logging for the rover."""


def log_reading(sensor, samples=None):
    if samples is None:
        samples = []
    samples.append(sensor.read())
    return samples


def plan_route(start, waypoints=None, options=None):
    """Build a route from start through every waypoint."""
    if waypoints is None:
        waypoints = []
    if options is None:
        options = {}
    waypoints.insert(0, start)
    options["length"] = len(waypoints)
    return waypoints, options


class Rover:
    def __init__(self, pins, telemetry=None):
        if telemetry is None:
            telemetry = list()
        self.pins = pins
        self.telemetry = telemetry

    def follow(self, route, seen=None):
        if seen is None:
            seen = set()
        # Skip anything we have already driven to.
        for waypoint in route:
            if waypoint in seen:
                continue
            seen.add(waypoint)
        return seen
