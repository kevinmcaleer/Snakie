## Making decisions 🔀

Programs can look at something and choose what to do next. That's what `if` and `else` are for — they let your code pick a path.

The starter code checks a `score` and reacts:

- `score = 7` puts the number 7 in a box called `score`.
- `if score >= 5:` asks a yes/no question — "is score 5 or more?"
- If the answer is **yes**, Python runs the `print("You passed!")` line.
- `else:` is the backup plan. If the answer is **no**, it runs `print("Try again")` instead.

Notice how only **one** of the two messages ever prints. Python picks a lane and sticks to it.

### Try it

1. Press **Run** ▶.
2. Watch the **console** — you should see `You passed!`
3. Change the first line to `score = 2` and press **Run** again.
4. Now the console says `Try again` — a different path!

### Now you

Add a middle path. Between the `if` and the `else`, try an `elif` (else-if):

```python
elif score >= 3:
    print("So close!")
```

Run it with `score = 4` and see which message wins.

> `>=` means "greater than or equal to". Swap it for `>`, `<`, or `==` (is it exactly equal?) to ask different questions.
