"""A decorator changes what the method *is*, one level below the class.

`@property` makes `millivolts` part of the instance's attribute surface, so the
call site is `Battery().millivolts` with no parentheses; a module-level `def`
cannot be reached that way. `@classmethod` is no better — `build` is a factory
for the very class the rule would be proposing to delete.
"""


class Battery:
    @property
    def millivolts(self):
        return 3300


class Route:
    @classmethod
    def blank(cls, name):
        return cls()
