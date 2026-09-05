from machine import Timer

# Plenty of things have an active() method. Only a WLAN has this problem.
watchdog = Timer(0)
watchdog.active(True)
watchdog.connect("nonsense")
