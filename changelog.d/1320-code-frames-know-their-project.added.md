- **Code frames know the project they are on (#1320).** `project=<id>` on a
  code embed reads a kevsrobots project's public wiring and names the part on
  each pin in the board strip ("GP15, Servo 1"). `paths=main.py,servo.py`
  shows several files of a repo as tabs. Frames on one page now share what
  they point at: hover a pin in one and the others light it, and the page
  hears `snakie:pin-hover`, `snakie:pin-state` and `snakie:pins` events (the
  last one says where the code and the wiring disagree). Wires in an exported
  wiring SVG carry their ids, so a page can light the wire for a pin.
