from machine import SPI, Pin

spi = SPI(0, baudrate=1_000_000, sck=Pin(2), mosi=Pin(3))


def shift_out(byte):
    spi.write(bytes([byte]))
