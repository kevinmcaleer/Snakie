"""Greenhouse logger on an ESP32, written with two-space indents.

`sleep` came in bare, from `from time import sleep`, so the rewrite has to add
`ticks_ms` and `ticks_diff` to the same import line.
"""
from time import sleep, ticks_ms, ticks_diff
from machine import Pin
import dht

sensor = dht.DHT22(Pin(4))
heartbeat = Pin(2, Pin.OUT)

sleep(1)

last_tick = ticks_ms()
while True:
  if ticks_diff(ticks_ms(), last_tick) >= 2000:
    last_tick = ticks_ms()
    sensor.measure()
    heartbeat.toggle()
    print("{:.1f} C  {:.0f} %RH".format(sensor.temperature(), sensor.humidity()))
