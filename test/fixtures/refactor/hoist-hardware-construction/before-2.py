from machine import I2C, Pin
from time import sleep_ms


def scan_bus(rounds):
	found = []
	for _ in range(rounds):
		bus = I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000)
		found.append(bus.scan())
		sleep_ms(100)
	return found
