def setup(pin):
    led = Pin(pin, Pin.OUT)
    if led.value():
        led.off()
        log("turned off")
