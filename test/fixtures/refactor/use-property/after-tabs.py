class Buzzer:
	def __init__(self, pwm):
		self._pwm = pwm
		self._volume = 0

	@property
	def volume(self):
		return self._volume

	@volume.setter
	def volume(self, value):
		self._volume = min(value, 100)
