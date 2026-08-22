"""Tab-indented station-keeping helpers."""


def hold_position(drift, motors):
	motors.brake()
	motors.report()
