Built-in functions — always available, no import needed.

## Everyday helpers

```python
len([1, 2, 3])          # 3 — items in a list/str/dict
range(5)                # 0..4 (see the Control flow article)
min(3, 7), max(3, 7)    # 3, 7 — also work on lists
sum([1, 2, 3])          # 6
abs(-5)                 # 5
round(3.14159, 2)       # 3.14
sorted([3, 1, 2])       # [1, 2, 3] (a new list)
```

## Looping helpers

```python
for i, name in enumerate(["red", "green"]):   # index + value
    print(i, name)

for pin, label in zip([0, 1], ["SDA", "SCL"]):  # pairwise
    print(pin, label)
```

## Conversions

```python
int("42"), float("0.5"), str(3.3)
hex(60)          # '0x3c' — I2C addresses
bin(10)          # '0b1010'
chr(65), ord("A")  # 'A', 65
```

## In the REPL

```python
help(machine)      # what a module offers
dir(i2c)           # every attribute/method on an object
```

`dir()` is the fastest way to explore a driver you just installed.
