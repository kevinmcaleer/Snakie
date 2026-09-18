# buckets: method call on an object, for/in, f-string, .append()
from machine import I2C, Pin

i2c = I2C(0, sda=Pin(0), scl=Pin(1))

found = []
for address in i2c.scan():
    found.append(address)
    print(f"device at {address:#x}")

print(len(found))
