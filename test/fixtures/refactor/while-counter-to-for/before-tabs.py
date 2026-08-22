"""Tab-indented motor test rig."""


def pulse(motor, count):
	i = 0
	while i < count:
		motor.step()
		print("pulse", i)
		i += 1
	motor.release()
