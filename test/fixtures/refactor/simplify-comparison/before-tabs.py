"""Bus watchdog — tab-indented, and one comparison already under a `not`."""


def watch(bus, alarm):
	if not bus.ready == False:
		alarm.clear()
	while bus.busy == True and bus.handle != None:
		bus.pump()
	return [d for d in bus.devices if d.online != True]
