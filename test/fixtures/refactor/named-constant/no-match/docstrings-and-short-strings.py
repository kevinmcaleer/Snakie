"""Telemetry helpers."""


def heartbeat(link):
    """Send a beat."""
    link.write("!")
    link.write("!")


def ping(link):
    """Send a beat."""
    link.write("?")
    link.write("?")
