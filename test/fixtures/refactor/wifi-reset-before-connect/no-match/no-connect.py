import network

# An access point is brought up but never connects out, so the trap does not apply.
ap = network.WLAN(network.AP_IF)
ap.active(True)
ap.config(essid="snakie", password="hunter2")
