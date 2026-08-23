"""Third-party packages whose names merely begin with a `u`.

`umqtt` and `urequests` are separate distributions, not deprecated aliases —
there is no plain `mqtt` or `requests` on a Pico to fall back to.
"""
try:
    import umqtt.simple
except ImportError:
    import mqtt.simple

try:
    import urequests as requests
except ImportError:
    import requests

try:
    import ulogging
except ImportError:
    import logging
