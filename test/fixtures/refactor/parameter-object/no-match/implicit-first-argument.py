"""`self` and `cls` are bound by the call, so they are not what the caller types."""


class PathPlanner:
    def waypoint(self, x, y, heading, speed, dwell_ms):
        self.points.append((x, y, heading, speed, dwell_ms))

    @classmethod
    def from_route(cls, points, speed, dwell_ms, loop, name):
        planner = cls()
        planner.points = points
        planner.speed = speed
        planner.dwell_ms = dwell_ms
        planner.loop = loop
        planner.name = name
        return planner
