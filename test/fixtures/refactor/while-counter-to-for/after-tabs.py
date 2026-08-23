"""Tab-indented motor test rig."""


def pulse(motor, count):
	for i in range(count):
		motor.step()
		print("pulse", i)
	motor.release()
