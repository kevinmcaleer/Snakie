This name is `camelCase`; the rest of Python (and this file) is `snake_case`.

```python
def follow_line(sensor):        def follow_line(sensor):
    motorSpeed = 40                 motor_speed = 40
    while sensor.value():           while sensor.value():
        motorSpeed -= 5      →          motor_speed -= 5
        drive(motorSpeed)               drive(motor_speed)
    return motorSpeed               return motor_speed
```

#451 calls rename "the simplest type of refactoring", and it is — *once you
have scope analysis*. Find-and-replace on the word `motorSpeed` also hits the
attribute `self.motorSpeed`, the string `"motorSpeed"`, the keyword argument
`spin(motorSpeed=1)` and the unrelated `motorSpeed` local two functions down.
Every one of those is a different thing that merely spells the same. Snakie
renames a *binding*: `bindingScopeFor` finds which scope owns the name at
the cursor and `referencesTo` returns that scope's own uses of it,
skipping any nested scope that rebinds it. That is the whole reason #451 hangs
off this epic rather than being a two-line editor command.

**Where the new name comes from.** A rule cannot prompt, so it never invents
meaning. The only rename offered automatically is the one that is derivable
and unambiguous: `camelCase`/`PascalCase` → `snake_case`, which is what PEP 8
asks for and what the rest of a MicroPython file already looks like. A name
that is already snake_case gets no offer, and a single letter gets none either
— turning `d` into something meaningful takes knowledge of the robot that is
not in the file. For an interactive rename with a name the user typed, the
editor layer calls `renameEdits` directly.

**Selection-driven.** With no cursor there is no symbol, so Snakie returns
nothing during the whole-file hint pass — a Problems entry per camelCase
variable would be nagging, not help.

**What it refuses, and why.** The rewrite must be provable from this one file:

- **Anything bound at module scope.** `motorSpeed = 0` at the top of
  `robot.py` is that module's public surface — another file may say
  `from robot import motorSpeed`, and the REPL may poke it by name. We cannot
  see those, so we decline (). A name bound inside a `def` cannot be
  reached from outside it, which is exactly what makes *that* rename provable.
  Class bodies go the same way: a class-level name is an attribute of the
  class, reachable as `Cls.name` from anywhere.
- **Parameters of anything but a closure.** `spin(motorSpeed=200)` passes the
  parameter by name from a call site this file may not contain, and the
  keyword in a call is not a name in any scope. Only a `def` nested inside
  another `def` — whose every caller is necessarily inside that enclosing
  function — is eligible, and even then only when no keyword argument
  anywhere in the file spells the name.
- **Import bindings.** Renaming the `machine` in `import machine` needs the
  `import` line rewritten too (`import machine as mach`), which is a different
  refactoring; the reference set does not include the line.
- **Dunder and `ALL_CAPS` names.** `__init__` is a protocol, `__x` is name
  mangled, and a constant is exactly the kind of name another module imports.
- **Names touched by `global`/`nonlocal`.** The declaration itself carries no
  `Name` node, so a rename would leave it pointing at the old spelling.
- **Names that appear inside an f-string.** The parser keeps an f-string
  opaque (it is a `Constant`), so `f"{motorSpeed}"` is invisible to the
  reference set — renaming around it would leave a `NameError` waiting on the
  board.
- **Anything the new name would collide with**, including a binding in a scope
  *between* a reference and its own scope: renaming a global to `motor_speed`
  when the function that reads it has a local `motor_speed` would silently
  repoint the read.

[#451]: https://github.com/kevinmcaleer/Snakie/issues/451
