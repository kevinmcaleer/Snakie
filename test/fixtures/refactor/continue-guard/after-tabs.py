def blink_faults(faults, led):
	for fault in faults:
		if not fault.active:
			continue
		led.on()
		sleep_ms(fault.code * 100)
		led.off()
