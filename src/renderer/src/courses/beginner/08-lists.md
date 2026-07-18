## Lists 📋

A list is one box that holds many things, kept in the order you put them. Perfect for a bunch of pets, high scores, or colours.

Look at the starter code:

- `pets = ["cat", "dog", "fish"]` makes a list with three items inside the square brackets `[ ]`.
- `for pet in pets:` walks through the list one item at a time, calling each one `pet`.
- `len(pets)` counts how many items are in the list — here that's `3`.

### Try it

1. Press Run ▶.
2. Watch the console print a line for each pet: "I have a cat", then dog, then fish.
3. The last line shows `Total: 3` — that's `len()` counting for you.

### Now you

Add another animal to the list, like `"rabbit"`. Put it inside the brackets with a comma before it:

```python
pets = ["cat", "dog", "fish", "rabbit"]
```

Run again. The loop prints an extra line, and `Total:` climbs to `4` all by itself — you didn't have to change anything else!

> A list keeps things in order, and `len()` always tells you how many. Change the list, and your loop just follows along.
