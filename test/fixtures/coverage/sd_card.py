# buckets: nested import, try/except, with, method call on an object, raise
import os

from machine import SPI, Pin


def mount(slot):
    try:
        import sdcard
    except ImportError:
        raise RuntimeError("sdcard driver missing")
    spi = SPI(slot)
    card = sdcard.SDCard(spi, Pin(13))
    os.mount(card, "/sd")
    return card


def copy(source, target):
    with open(source, "rb") as src:
        with open(target, "wb") as dst:
            dst.write(src.read())
