# Dictionaries

A **list** keeps things in order and you reach them by *position*: the first
reading, the third pose. A **dictionary** keeps things by *name*, and you reach
them by that name.

```python
config = {'pin': 15, 'speed': 200}
print(config['pin'])
```

That is the shape of almost every piece of settings, every pin map, every note
table and every JSON payload a board ever receives.

## Making one

**dictionary of `name` is `value` and `other` is `value`** — press **+** for
another pair, **−** for one fewer. The keys are sockets rather than typed-in
text, because a key is as often a variable or a number as it is a word: a note,
a pin, a command byte.

```python
notes = {'C': 262, 'D': 294, 'E': 330}
```

## Getting a value out — and the KeyError

There are two blocks, and the difference matters the first time a key is
missing.

- **get `k` of `d` or `0`** hands back the `0` when `k` is not there. Python
  writes it `d.get(k, 0)`.
- **get `k` of `d`** — plain — **stops the program** with a `KeyError` when the
  key is not there.

The drawer offers the safe one first on purpose. Use the plain one when the key
is definitely there; use `… or …` for anything that came from outside your
program — a config file, a message, a sensor.

## Changing one

- **set `k` of `d` to `v`** — adds the key if it is new, replaces the value if
  it is not.
- **remove `k` from `d`** — takes the key out. Python writes it
  `del d[k]`, and removing a key that is not there stops the program.

## Going through a whole dictionary

Use **the key-and-value pairs of `d`** with the two-name loop from Control:

```python
for name, frequency in notes.items():
    print(name, frequency)
```

**the keys of `d`** and **the values of `d`** give you one side on its own.

## Two questions this drawer does not answer, and where they live

- **"Is this key in it?"** — that is `'k' in d`, and the **is in** block in the
  **Logic** drawer does it. It is one block for lists, text, dictionaries and
  buffers, rather than a different one per drawer.
- **"How many?"** — `len(d)`, which is the **length of** block in **Lists**. It
  counts a dictionary happily.
