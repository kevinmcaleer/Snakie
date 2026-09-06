#!/usr/bin/env bash
#
# BUILD mpy-cross TO WEBASSEMBLY (#950, enabling #949).
# =============================================================================
#
# `mpy-cross` is MicroPython's own cross-compiler: it turns `foo.py` into the
# `foo.mpy` bytecode container a board imports without ever seeing the source.
# We ship it as WebAssembly rather than a native binary for three reasons — no
# per-platform builds, no third executable to sign and notarize inside the app
# bundle, and it will run in the web build the day we want it there.
#
# THE LIST NOBODY MAINTAINS. The obvious way to do this — and the way the
# published `@pybricks/mpy-cross-v6` package does it — is a Makefile that names
# every `py/*.c` file explicitly. That list is why that package is still on
# MicroPython v1.19: it has ~108 entries and v1.29 has 133. So this build does
# not have a list. It sets `PROG` to a `.js` and lets MicroPython's own `py.mk`
# compute `PY_CORE_O`, which means the build tracks whatever the pinned tag
# below actually needs, and moving to a new MicroPython is a one-line change.
#
# NO THIRD-PARTY GLUE EITHER. pybricks bakes its filesystem/callback wiring into
# the artifact with `--pre-js`. We pass `preRun` / `print` / `printErr` /
# `onExit` on the Module object from `src/main/mpy/compile.ts` instead, so what
# ships here is mpy-cross and nothing else.
#
# THE LOADER IS `.cjs`, NOT `.js`. Emscripten emits a CommonJS file whose export
# line is guarded by `typeof module === "object"`. This package.json is
# `"type": "module"`, so a `.js` here is parsed as ESM, that branch never runs,
# and `require()` hands back an empty object — the same reason the preload has to
# be `index.cjs` (see CLAUDE.md). Renaming it on the way out is the whole fix.
#
# Requires Docker. Takes a couple of minutes. Run it when moving to a new
# MicroPython release, and commit what it writes:
#
#     ./scripts/build-mpy-cross.sh
#
set -euo pipefail

# The MicroPython release to build the compiler from. Keep this in step with the
# firmware the Board Finder offers — a compiler older than the boards is exactly
# the drift we are avoiding by owning this build.
MICROPYTHON_TAG="${MICROPYTHON_TAG:-v1.29.0}"

# Pinned so a rebuild is reproducible. `latest` moved under us once already
# (the INCOMING_MODULE_JS_API pruning below arrived with a newer emcc).
EMSDK_IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:latest}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/resources/mpy-cross"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ MicroPython $MICROPYTHON_TAG"
git clone -q --depth 1 --branch "$MICROPYTHON_TAG" \
  https://github.com/micropython/micropython.git "$WORK/micropython"

echo "→ building with $EMSDK_IMAGE"
docker run --rm -v "$WORK/micropython:/src" -w /src/mpy-cross "$EMSDK_IMAGE" bash -c '
  set -e
  # CC=emcc directly, NOT `emmake make`: emmake rewrites `gcc` to `emgcc`, which
  # is not a program that exists, and the qstr generation dies on it.
  make -j"$(nproc)" \
    CC=emcc LD=emcc AR=emar \
    PROG=mpy-cross.js \
    COPT=-Oz \
    LDFLAGS_ARCH= STRIP= SIZE=true CWARN=-Wall \
    LDFLAGS_EXTRA="-Oz \
      -s MODULARIZE=1 \
      -s EXPORT_NAME=MpyCross \
      -s EXIT_RUNTIME=1 \
      -s ALLOW_MEMORY_GROWTH=1 \
      -sINCOMING_MODULE_JS_API=wasmBinary,arguments,preRun,print,printErr,onExit \
      -sEXPORTED_RUNTIME_METHODS=FS"
' >/dev/null

mkdir -p "$OUT"
cp "$WORK/micropython/mpy-cross/build/mpy-cross.js"   "$OUT/mpy-cross.cjs"
cp "$WORK/micropython/mpy-cross/build/mpy-cross.wasm" "$OUT/mpy-cross.wasm"

# Record what produced these, so the committed binaries are traceable to a tag
# rather than to whoever last ran the script.
cat > "$OUT/BUILD.json" <<JSON
{
  "micropython": "$MICROPYTHON_TAG",
  "emsdk": "$EMSDK_IMAGE",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "→ wrote:"
ls -l "$OUT" | awk 'NR>1 {printf "   %-18s %8s bytes\n", $9, $5}'
