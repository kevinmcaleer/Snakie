import network

wlan = network.WLAN(network.STA_IF)
wlan.active(False)
wlan.active(True)
wlan.connect("workshop", "hunter2")
