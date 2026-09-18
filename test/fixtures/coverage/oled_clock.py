# buckets: self.x.y() call, f-string in a call, method call on an object
from machine import I2C, Pin, RTC
import ssd1306
import time

i2c = I2C(0, sda=Pin(4), scl=Pin(5))
display = ssd1306.SSD1306_I2C(128, 64, i2c)
clock = RTC()

while True:
    parts = clock.datetime()
    hour = parts[4]
    minute = parts[5]
    display.fill(0)
    display.text(f"{hour:02d}:{minute:02d}", 0, 0)
    display.show()
    time.sleep(1)
