"""A shim whose two branches do not bind the same names.

The two sides are the same *length* but not the same set: the `try` binds only
`dumps`, while the fallback also binds `loads` — and this file already has a
`loads` of its own. Collapsing to the fallback would quietly shadow it, so the
rule declines.
"""


def loads(text):
    return {"raw": text}


try:
    from ujson import dumps, dumps
except ImportError:
    from json import dumps, loads


print(loads("{}"), dumps({}))
