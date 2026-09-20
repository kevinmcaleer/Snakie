# The coverage fixture corpus (W0, epic #1086)

Forty-odd MicroPython files, chosen to span the buckets `docs/blocks-coverage-epic.md`
§3 measured against Kevin's 688-file corpus. That corpus cannot live in the repo —
it is 85,000 lines of somebody's personal projects — so this stands in for it, and
`test/blocksCoverageRatchet.test.ts` floor-asserts the numbers it produces.

The rule for anything added here: **it must be MicroPython somebody would really
write.** A fixture invented to make a recogniser pass is a fixture that measures
the recogniser against itself. Each file names, at the top, which buckets it is
here for.

The ratchet asserts three things over every file (§2.3):

- **statement coverage** — recognised / total logical lines, floor-asserted;
- **socket coverage** — value sockets holding a real block rather than a grey
  `snakie_python_value` / `snakie_python_call_value`, floor-asserted separately
  because `rawValue()` never increments `report.raw` and a single number would
  be blind to it;
- **round-trip** — every file still converts and regenerates to the same program.

Since **B6 of epic #1206** (#1225) it also asserts a fourth thing over the
**class-heavy slice** — the fixtures with a `class` header in them, measured on
their own so that the classes track has a number of its own, and so that every
`class` header still reads as a real `snakie_class` block. `motor_driver.py`,
`thermostat.py`, `blinker_subclass.py` and `node_queue.py` were added for it and
span `__init__`, `self.x` get and set, `obj.x` on someone else's object, a
`@property` with a setter, `super()`, `@staticmethod`, and constructing an
instance. `docs/blocks-classes-epic.md` has the numbers.

Floors go UP when a workstream lands, never down —
except when new fixtures make the corpus harder, which is what happened at B6
and is argued for in the test beside the floor it lowered. A change that lowers one is
either a regression or a deliberate trade, and either way it should be argued for
in a pull request rather than absorbed silently.
