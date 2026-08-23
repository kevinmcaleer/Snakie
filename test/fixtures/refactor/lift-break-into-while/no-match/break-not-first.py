"""The loop does work before it tests, so the test is not the condition."""

import time


def drain(queue, sink):
    while True:
        sink.flush()
        if queue.empty():
            break
        sink.write(queue.pop())
        time.sleep_ms(5)


def blink(led, stop_flag):
    while True:
        led.toggle()
        if stop_flag.is_set():
            break
        time.sleep_ms(250)
