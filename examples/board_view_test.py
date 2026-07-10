from machine import Pin, I2C, PWM, ADC
from time import sleep
import instruments as inst
from bme280 import BME280
from icm20948 import ICM20948

i2c = I2C(id=0,sda=4,scl=5)
pwm = PWM(Pin(0))
adc = ADC(Pin(26))
imu = ICM20948(i2c)
# led = Pin("LED")

bme280 = BME280(i2c)
t, p, h = bme280.read()
print(f"temp: {t}, pressure: {p}, humidity: {h}")

inst.start()
duty = 1000
pwm.freq(1000)
while True:
    pwm.duty_u16(duty)
    if duty > 4500:
        duty = 1000

    duty +=1
    print(f"duty: {duty}")
    inst.read_pwm(pwm)
    sleep(0.01)
    # led.toggle()