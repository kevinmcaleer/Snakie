"""Both classes describe themselves already."""


class Waypoint:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return "Waypoint({}, {})".format(self.x, self.y)


class Reading:
    def __init__(self, celsius, humidity):
        self.celsius = celsius
        self.humidity = humidity

    def __str__(self):
        return "{} C".format(self.celsius)

    def __repr__(self):
        return f"Reading(celsius={self.celsius!r}, humidity={self.humidity!r})"
