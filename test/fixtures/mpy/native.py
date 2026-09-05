# Source for native.mpy — an ARMV7M native-code .mpy, so the header/arch decode
# and the NATIVE_PY prelude-offset path are exercised on real bytes.
# Regenerate with:  mpy-cross -march=armv7m -o native.mpy native.py
@micropython.native
def fast_add(first, second):
    return first + second
