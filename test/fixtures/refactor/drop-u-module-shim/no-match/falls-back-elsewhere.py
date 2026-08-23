"""Try/except imports that are doing real work, not shimming a `u` name."""
try:
    import ujson
except ImportError:
    import simplejson as json

try:
    from machine import RTC
except ImportError:
    RTC = None

try:
    import network
except ImportError:
    network = None
