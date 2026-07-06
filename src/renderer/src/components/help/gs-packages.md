Install MicroPython libraries onto your board with **mip**, straight from Snakie.

## The Packages panel

Open **Packages** in the activity bar (left edge). With a board connected you'll
see:

- a **search box** — find a package in the registry (`micropython-lib` and
  GitHub packages),
- the **REGISTRY** list — search results, each with an **INSTALL** action,
- the **INSTALLED** list — what's already on the board,
- a **Flash storage used** meter, so you can see how much room is left.

## Installing

1. Connect your board (installing runs code on it over the REPL).
2. Search for the package (e.g. `ssd1306`, `umqtt.simple`).
3. Click **INSTALL**. Snakie runs `mip.install(...)` on the board and streams
   the log; packages land in `/lib`, which is on `sys.path` — so after a
   reboot (or straight away) you can just `import` it.

Boards without Wi-Fi (like a plain Pico) can't fetch packages themselves —
Snakie handles that by downloading on the computer and copying the files over,
so mip works on every board.

## Advanced options

Expand **Advanced options** to install from a **custom index URL** or a
`github:user/repo` spec, and to control whether existing files are overwritten.

## Parts install their own drivers

When a part on the Board View needs a driver (e.g. the VL53L0X), Snakie offers
to install it for you — see the banner that appears above the editor. Bundled
drivers copy to `/lib`; registry ones install via mip, exactly as above.
