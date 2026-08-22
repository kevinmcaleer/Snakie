"""Waypoint logging for the rover."""


def log_reading(sensor, samples=[]):
    samples.append(sensor.read())
    return samples


def plan_route(start, waypoints=[], options={}):
    """Build a route from start through every waypoint."""
    waypoints.insert(0, start)
    options["length"] = len(waypoints)
    return waypoints, options


class Rover:
    def __init__(self, pins, telemetry=list()):
        self.pins = pins
        self.telemetry = telemetry

    def follow(self, route, seen=set()):
        # Skip anything we have already driven to.
        for waypoint in route:
            if waypoint in seen:
                continue
            seen.add(waypoint)
        return seen
