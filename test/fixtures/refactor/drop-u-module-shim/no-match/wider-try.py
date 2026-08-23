"""Shim-shaped blocks that catch or run more than the import."""
try:
    import ujson
except (ImportError, AttributeError):
    import json

try:
    import uos
except ImportError:
    import os
finally:
    print("filesystem module ready")

try:
    import uselect
except ImportError as err:
    print("no select:", err)
    import select
