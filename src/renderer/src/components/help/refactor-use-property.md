```python
class Servo:                     class Servo:
    def get_angle(self):             @property
        return self._angle           def angle(self):
                                         return self._angle
    def set_angle(self, value):
        self._angle = value          @angle.setter
                             →       def angle(self, value):
s.set_angle(90)                          self._angle = value
print(s.get_angle())
                                 s.angle = 90
                                 print(s.angle)
```

Java-style accessor pairs are the commonest thing people bring with them into
Python. A property gets the same encapsulation — the setter still runs, so it
can clamp the angle or kick the PWM — while the call site reads like the plain
attribute it conceptually is.

**This one really does need your eyes, and that is not a formality.** Renaming the two
methods breaks *every* caller: `s.get_angle()` has to become `s.angle`, and
`s.set_angle(90)` has to become `s.angle = 90`. The engine can only see one
file, so callers in another module — or on the board's filesystem, or in a
plugin — are invisible to it and will raise `AttributeError` the next time
they run. That is why "Tidy this file" never batches this one, and why the
match message says so out loud before anybody clicks it.

Declined when: the class already has a member of the property's name (the
rewrite would shadow it); the setter is written *before* the getter (the
`@angle.setter` decorator needs `angle` to already exist at that point in the
class body); either method carries a decorator of its own; or the two are not
demonstrably a pair — the getter must return the attribute the setter writes,
and the setter must actually use its value parameter.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
