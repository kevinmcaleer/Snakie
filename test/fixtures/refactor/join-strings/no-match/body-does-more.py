"""The loop also writes to the UART, so it is not a pure accumulation."""


def echo_rows(rows, uart):
    text = ""
    for row in rows:
        uart.write(row)
        text += row
    return text


def poll(uart):
    buffer = ""
    while uart.any():
        buffer += uart.read().decode()
    return buffer
