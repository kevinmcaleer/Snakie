"""The counter moves before the work, so the body sees 1..n rather than 0..n-1."""


def blink(led, times):
    i = 0
    while i < times:
        i += 1
        led.toggle()
        print("blink", i)
