# buckets: method call on an object, attribute read, f-string inside a call
from machine import ADC
import time

sensor = ADC(4)

while True:
    raw = sensor.read_u16()
    volts = raw * 3.3 / 65535
    temperature = 27 - (volts - 0.706) / 0.001721
    print(f"{temperature:.1f} C")
    time.sleep(2)
