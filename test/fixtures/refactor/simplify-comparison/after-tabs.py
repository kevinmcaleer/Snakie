"""Bus watchdog — tab-indented, and one comparison already under a `not`."""


def watch(bus, alarm):
	if not (not bus.ready):
		alarm.clear()
	while bus.busy and bus.handle is not None:
		bus.pump()
	return [d for d in bus.devices if not d.online]
