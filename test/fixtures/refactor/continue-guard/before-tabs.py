def blink_faults(faults, led):
	for fault in faults:
		if fault.active:
			led.on()
			sleep_ms(fault.code * 100)
			led.off()
