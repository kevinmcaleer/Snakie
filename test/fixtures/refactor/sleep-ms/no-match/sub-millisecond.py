import time


def pulse(trigger):
    # 500 microseconds — sleep_us is the right call here, not sleep_ms.
    trigger.on()
    time.sleep(0.0005)
    trigger.off()
