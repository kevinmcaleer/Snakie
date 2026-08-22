"""A long file is not a long function — only the `def`s are measured."""

from machine import I2C, Pin

SDA = 4
SCL = 5
FREQ = 400000

BME280 = 0x76
SSD1306 = 0x3C
PCA9685 = 0x40
MPU6050 = 0x68

NAMES = {
    BME280: "bme280 weather sensor",
    SSD1306: "ssd1306 oled",
    PCA9685: "pca9685 servo driver",
    MPU6050: "mpu6050 imu",
}

bus = I2C(0, sda=Pin(SDA), scl=Pin(SCL), freq=FREQ)
present = bus.scan()

print("scanning the i2c bus")
print("sda:", SDA)
print("scl:", SCL)
print("freq:", FREQ)

for address in present:
    print(hex(address), NAMES.get(address, "unknown device"))

if BME280 not in present:
    print("no weather sensor — readings will be missing")

if SSD1306 not in present:
    print("no display — falling back to the serial log")


def describe(address):
    return NAMES.get(address, "unknown device")


def is_present(address):
    return address in present
