Snakie checks your code as you type and collects everything it finds in one
place.

## Squiggles & the Problems tab

Python files are linted live (via the bundled linter plugins); **YAML** and
**JSON** files are validated too — a stray tab, duplicate key or unclosed
bracket gets a squiggle right in the editor.

The **Problems** tab (bottom panel, next to Console) lists every diagnostic for
the active file with its line and message. Click a row to jump straight to the
spot. Errors and warnings are labelled so screen readers and colour-blind users
get the severity too. Linting can be toggled from the Problems header.

## Autofix for YAML & JSON

When a YAML/JSON file parses but is untidy (or uses a fixable style), the
Problems panel shows a **Fix / Format** button — one click rewrites the file in
canonical form and the squiggles disappear. This is handy for `parts.yml` and
`robot.yml`, which Snakie itself reads.

## Board-aware checks

With a board selected, Snakie also checks your **bus wiring in code**: an
`I2C(0, sda=Pin(...), scl=Pin(...))` with pins that don't belong to I2C0 on
*your* board gets flagged, with a quick-fix to the nearest valid pins. The same
applies to SPI and UART. It's the "wrong pin number" mistake — caught before
you spend an hour on it.
