# buckets: method call on an object, attribute read, while, trailing comment, raise
import network
import time

SSID = "workshop"
PASSWORD = "hunter2"


def connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    waited = 0
    while not wlan.isconnected():
        time.sleep(1)
        waited += 1  # seconds so far
        if waited > 20:
            raise OSError("no wifi")
    return wlan.ifconfig()
