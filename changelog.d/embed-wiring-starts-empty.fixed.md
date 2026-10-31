- **The embedded wiring canvas no longer adds a Raspberry Pi Pico 2 W by
  itself.** With no board set, the embed fell back to the app's default board,
  so every kevsrobots.com wiring started with a Pico whether the project used
  one or not. A wiring without a board now has none, and the new
  `setBoard(id | null)` handle method lets the host pick one or take it away.
  The browser panel also hides the project name, description and mass readout
  unless the host asks for them (`projectMeta`), and the host can set the empty
  canvas's hint (`emptyHint`).
