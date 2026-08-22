"""Folding these would run past 100 columns — a wrapped one-liner is worse."""


def describe(sensor, verbose):
    if verbose:
        summary = "{} read {} on bus {} at 0x{:02x}".format(
            sensor.name, sensor.value, sensor.bus, sensor.address
        )
    else:
        summary = sensor.name
    return summary


class Rover:
    def cruise_target(self, following, leader_distance_mm, configured_cruise_speed_mm_s):
        if following:
            self.controller.cruise_target = leader_distance_mm * 2
        else:
            self.controller.cruise_target = configured_cruise_speed_mm_s
        return self.controller.cruise_target
