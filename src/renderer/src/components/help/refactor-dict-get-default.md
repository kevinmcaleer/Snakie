This `if`/`else` is what `dict.get(key, default)` already does.

```python
if name in config:              value = config.get(name, 0)
    value = config[name]
else:
    value = 0
```

Four lines and two lookups say what the dictionary already does in one:
`get` *is* "the value if the key is there, otherwise this". The long form also
hides a real hazard — the key is looked up twice, so the two halves can drift
apart in editing (`config[name]` quietly becoming `config[key]`), and on a
microcontroller you have paid for the hash twice for no reason.

The rewrite is offered only when the three parts line up exactly: the same
name is assigned in both branches, the subscript reads the same mapping the
`in` tested, and with the same key. The mapping, the key and the fallback must
all be pure — the mapping and key because they go from being evaluated twice
to once, and the fallback because `get` evaluates its default *eagerly*, so a
call there would start running on the hit path too.
