# kevsrobots.com catalog-only parts

Parts for the [kevsrobots.com](https://www.kevsrobots.com) parts catalog that
**Snakie must not offer** — boards that MicroPython doesn't run on, such as the
Arduino UNO R3, UNO R4 and UNO Q, and shields for them (the Arduino Motor Shield Rev3 and the FunduMoto
L298P motor shield). A shield declares `footprint: uno-shield` and repeats the
UNO's headers by name; every UNO has a `shield` mount, so the shield drops
onto the UNO and its pins join the UNO's.

Each folder is an ordinary Snakie part (`parts.yml`, image, `help.md`,
`model.stl`), in the same format as `../snakie-standard/`, so the Part Editor
and the existing tooling work on it. The difference is only where it lives:

- Snakie loads and bundles **only** `snakie-standard/` (see
  `src/main/parts/library.ts` and `electron-builder.yml`), so nothing in here
  reaches the app or the published Standard library.
- kevsrobots.com's `import_snakie_parts --github` and **Sync from Snakie**
  import this folder as well as `snakie-standard/`.

There is deliberately no `library.yml` here: the importer unpacks this folder
beside the Standard library, and the Standard library's manifest is the one
that names the import.
