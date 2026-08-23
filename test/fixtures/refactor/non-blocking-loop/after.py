"""Line-following rover: telemetry over UART and a slow pan-servo sweep.

Both loops block on `time.sleep()`, so while either one is waiting the other
cannot run and neither can anything else on the board.
"""
import time
from machine import ADC, PWM, Pin, UART

uart = UART(0, 115200)
line_sensor = ADC(26)
status_led = Pin(25, Pin.OUT)
pan = PWM(Pin(15))
pan.freq(50)


def report_telemetry():
    last_tick = time.ticks_ms()
    while True:
        if time.ticks_diff(time.ticks_ms(), last_tick) >= 100:
            last_tick = time.ticks_ms()
            reading = line_sensor.read_u16()
            status_led.toggle()
            uart.write("line {}\n".format(reading))


def sweep_pan():
    angle = 0
    step = 5
    last_tick = time.ticks_ms()
    while True:
        if time.ticks_diff(time.ticks_ms(), last_tick) >= 20:
            last_tick = time.ticks_ms()
            angle = angle + step
            # Bounce back off whichever end stop we reached.
            if angle >= 180 or angle <= 0:
                step = -step

            pan.duty_u16(1638 + angle * 46)
