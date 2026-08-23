"""`f` and `log` are files in one place and something else in another.

Nothing here writes to flash inside a loop. The first `f` is a file, but the
`f` in `stream()` is a socket's stream, and the `log` the loop writes to has
been rebound to a UART. A file-wide set of handle *names* would call both of
those flash writes; the binding each name actually has where the loop runs is
what decides.
"""
import time
from machine import UART


def save(rows):
    f = open("settings.csv", "w")
    f.write("".join(rows))
    f.close()


def stream(sock, lines):
    f = sock.makefile("wb")
    for line in lines:
        f.write(line)
        time.sleep_ms(5)


log = open("boot.txt", "a")
log.write("ready\n")
log.close()
log = UART(1, 115200)


def telemetry(samples):
    for n in range(samples):
        log.write("%d\n" % n)
        time.sleep_ms(10)


def echo(handle, lines):
    # `handle` is bound by the caller, so this file cannot say it is a file.
    for line in lines:
        handle.write(line)
