"""A shim with a comment below the kept import.

The comment belongs to no statement, so the ranged edit cannot take it with the
block: collapsing the shim would leave it stranded at the handler's
indentation, under a `try` that is no longer there. The rule offers no rewrite.
"""
try:
    import uos
except ImportError:
    import os
    # keep this in step with the firmware build

print(os.uname())
