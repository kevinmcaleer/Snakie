"""Greenhouse logger on an ESP32, written with two-space indents.

`sleep` came in bare, from `from time import sleep`, so the rewrite has to add
`ticks_ms` and `ticks_diff` to the same import line.
"""
from time import sleep
from machine import Pin
import dht

sensor = dht.DHT22(Pin(4))
heartbeat = Pin(2, Pin.OUT)

sleep(1)

while True:
  sensor.measure()
  heartbeat.toggle()
  print("{:.1f} C  {:.0f} %RH".format(sensor.temperature(), sensor.humidity()))
  sleep(2)
