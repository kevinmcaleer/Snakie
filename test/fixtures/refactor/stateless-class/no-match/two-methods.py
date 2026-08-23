"""Two jobs under one name is a different conversation, not this one."""


class Units:
    def ticks_to_mm(self, ticks, wheel_radius, ticks_per_rev):
        return 2 * 3.14159 * wheel_radius * ticks / ticks_per_rev

    def mm_to_ticks(self, mm, wheel_radius, ticks_per_rev):
        return mm * ticks_per_rev / (2 * 3.14159 * wheel_radius)
