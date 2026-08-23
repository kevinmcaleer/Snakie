class Buzzer:
	def __init__(self, pwm):
		self._pwm = pwm
		self._volume = 0

	def get_volume(self):
		return self._volume

	def set_volume(self, value):
		self._volume = min(value, 100)
