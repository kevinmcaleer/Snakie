import micropython
import time

SAMPLE_INTERVAL_MS = micropython.const(20)
RING_LEN = micropython.const(64)
WARMUP_S = 2.5


def collect(sensor):
    ring = [0] * RING_LEN
    for i in range(RING_LEN):
        ring[i] = sensor.read_u16()
        time.sleep_ms(SAMPLE_INTERVAL_MS)
    return ring


def heap_report():
    micropython.mem_info()
