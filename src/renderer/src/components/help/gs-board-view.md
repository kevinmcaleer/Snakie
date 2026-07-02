The Board View is a separate, always-on-top window that pictures your wiring.

## Open it

Click the **board** button in the toolbar. It streams live, so the drawing updates as you type — it reads your source for `machine` constructors (`Pin`, `PWM`, `I2C`, `SPI`, `StateMachine`) and wires each used pad to a connection badge.

## Wire up parts

Drag parts from the **library dock** on the right onto the canvas and connect them to the board's pins. A **board selector** in the title bar switches between built-in boards and any you've authored.

## Views

Three tabs across the top:

- **Node graph** — parsed pin usage; the only view with live per-pin values.
- **Breadboard** — a life-like board + parts you wire by hand.
- **Schematic** — a wiring diagram.

Your last-used view is remembered.
