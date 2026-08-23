"""The class already exposes the name the property would take.

Renaming `get_speed` to `speed` would shadow the existing member, so the rule
declines rather than quietly losing one of them.
"""


class Drive:
    speed = 0

    def get_speed(self):
        return self._speed

    def set_speed(self, value):
        self._speed = value


class Gripper:
    def __init__(self):
        self._grip = 0

    def grip(self, force):
        self._grip = force

    def get_grip(self):
        return self._grip

    def set_grip(self, value):
        self._grip = value
