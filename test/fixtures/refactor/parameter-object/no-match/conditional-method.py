"""A method chosen at import time is still a method.

Cross-platform driver code defines the same `def` twice under an `if`, so the
method's parent is the branch rather than the class body. Its first parameter is
still the receiver, and counting it would push a perfectly ordinary five-value
signature over the threshold.
"""

import sys


class Display:
    if sys.platform == "rp2":

        def blit(self, buf, x, y, w, h):
            print("rp2", buf, x, y, w, h)

    else:

        def blit(self, buf, x, y, w, h):
            print("host", buf, x, y, w, h)
