def temperature(adc):
	if adc is None:
		raise RuntimeError("no ADC")
	else:
		reading = adc.read_u16()
		return reading * 3.3 / 65535
