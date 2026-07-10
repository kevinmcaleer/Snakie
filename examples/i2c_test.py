from machine import Pin, I2C
i2c = I2C(0, sda=Pin(20), scl=Pin(21), freq=100000)
print("scan:", [hex(a) for a in i2c.scan()])

# The BME280 (0x76) is on the SAME bus — can we READ it? (id should be 0x60)
try:    print("BME280 id:", hex(i2c.readfrom_mem(0x76, 0xD0, 1)[0]))
except Exception as e: print("BME280 read ERR:", e)

# Can we WRITE to the ICM (its address ACKs)?
try:    i2c.writeto(0x68, b'\x00'); print("ICM write OK")
except Exception as e: print("ICM write ERR:", e)