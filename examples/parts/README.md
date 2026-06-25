# Example parts library

A reference **parts library** for the Snakie [Parts Library](../../docs/parts-library.md)
(#129) — a folder of parts, each in its own folder with a human-readable
`parts.yml`, plus a `library.yml` manifest. Copy `snakie-basics/` into your
Snakie parts folder (`<userData>/parts/`, reachable via the **📁** button in the
Parts view) to try it, or use it as a template for your own library.

```
snakie-basics/
  library.yml          # the library manifest
  pico-2w/parts.yml    # Raspberry Pi Pico 2 W (a board)
  vl53l0x/parts.yml    # VL53L0X time-of-flight sensor (a breakout)
```

`registry.json` is an example of the **master community registry** — the index of
approved libraries the app fetches; administration is just PRs against the repo
that hosts it (see the docs).
