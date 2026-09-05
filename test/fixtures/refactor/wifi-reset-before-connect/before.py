import network
import time

SSID = "workshop"
PASSWORD = "hunter2"

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect(SSID, PASSWORD)

while not wlan.isconnected():
    time.sleep_ms(100)

print("WiFi up:", wlan.ifconfig()[0])
