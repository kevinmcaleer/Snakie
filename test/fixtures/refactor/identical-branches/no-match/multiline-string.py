"""Dedenting the block would dedent the inside of the banner text with it."""


def banner(verbose, uart):
    if verbose:
        uart.write("""
            Snakie rover
            ready
        """)
    else:
        uart.write("""
            Snakie rover
            ready
        """)
