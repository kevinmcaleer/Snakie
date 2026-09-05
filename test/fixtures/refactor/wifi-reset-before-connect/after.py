import network
import time

SSID = "workshop"
PASSWORD = "hunter2"

wlan = network.WLAN(network.STA_IF)
# A soft reboot leaves the radio as the last run left it.
wlan.active(False)
wlan.active(True)
wlan.connect(SSID, PASSWORD)

while not wlan.isconnected():
    time.sleep_ms(100)

print("WiFi up:", wlan.ifconfig()[0])
