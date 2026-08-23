"""A multi-line string in the block: re-indenting it would rewrite the text itself."""


def show_banner(display, version):
    banner = """
    Snakie rover
    firmware {}
    """.format(version)
    display.write(banner)
    display.show()
