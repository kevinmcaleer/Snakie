This class holds no state — its one method would read better as a plain function.

```python
# before — a class that holds nothing and does one thing
class Debouncer:
    def __init__(self):
        pass

    def settled(self, pin, samples, gap_ms):
        ...

reading = Debouncer().settled(button, 5, 10)

# after
def settled(pin, samples, gap_ms):
    ...

reading = settled(button, 5, 10)
```

A class with no state is a function wearing a costume. Every caller has to
build an instance that remembers nothing, purely so it can reach the one
method it wanted, and the reader has to check the whole class body before they
can be sure there is no hidden state to worry about.

On a microcontroller the costume also has a price: the type object lives in
flash, every `Debouncer()` allocates an instance (and an instance dict, unless
you remembered `__slots__`), and the method lookup goes through the type on
each call. A module-level `def` costs one object, once. None of that matters
on a desktop, which is why this is worth saying out loud here.

This is **hint only**: turning the method into a function moves it out of the
class's namespace, and every caller — including callers in files this engine
cannot see, on the board's filesystem or in a plugin — has to move with it.
Snakie makes no change; the panel shows the explanation and the "Why?" article.

Deliberately narrow, because "this class is pointless" is a rude thing to say
wrongly:

- exactly **one** method besides `__init__`, and at most one `__init__`;
- no base other than `object`, no `metaclass=`, and **nothing in the file may
  subclass it** — an abstract base whose one method is `raise
  NotImplementedError` is the most stateless class there is, and also the one
  you must not delete;
- the body may hold nothing but methods, a docstring and `pass`; a class
  attribute, a nested class or a `__slots__` line all mean it is carrying
  something;
- **no decorator, on the class or on any method.** A decorator can register
  the class, wrap it, or replace it outright, and `@property` in particular
  makes the method part of the instance's *attribute* surface, so lifting it
  out turns `v.millivolts` into `millivolts()` at every call site;
- the one method is not a dunder. `__call__`, `__getitem__`, `__enter__` and
  friends are protocol slots: the class exists precisely so `obj(x)` or
  `obj[i]` or `with obj:` works, and a plain function cannot be any of those;
- no method touches the instance except to call itself recursively — a class
  that grows its state lazily on first use still has state, even though
  `__init__` never mentions it.

The instance is found through each method's **first parameter**, not through
the literal name `self`. `self` is a convention rather than a keyword, and a
hard-coded name makes the whole state analysis blind to `def __init__(s,
pin): s.led = Pin(pin)` — a class that plainly holds a pin, which the rule
would otherwise announce as holding no state at all. A method with no
parameters (so no receiver to follow) is something we decline to reason about.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
