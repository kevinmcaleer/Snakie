"""Tab-indented station-keeping helpers."""


def hold_position(drift, motors):
	if drift < 0.1:
		motors.brake()
		motors.report()
	else:
		motors.brake()
		motors.report()
