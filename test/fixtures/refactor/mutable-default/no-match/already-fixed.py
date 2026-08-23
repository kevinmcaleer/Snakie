"""The idiom this rule produces — running it again must change nothing."""


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
