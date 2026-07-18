## Functions 🍳

A function is your own little command. You give it a name, teach it a job once, then call that name whenever you want the job done.

The starter code makes a function called `greet`:

- `def greet(who):` starts the recipe. `who` is a box that fills in when you call it.
- `print("Hello,", who)` is the job — it says hello to whoever `who` is.
- `greet("world")` and `greet("robot")` *call* the function. Each call fills `who` with a different word.

```python
def greet(who):
    print("Hello,", who)
```

### Try it

1. Press Run ▶.
2. Watch the console. You wrote `print` once, but it ran twice, with two names.
3. Notice how the same recipe gave two different messages.

### Now you

Add one more line at the bottom that greets *you*:

```python
greet("Sam")
```

Swap in your own name and Run again. Can you add three friends without writing `print` three times?

> Write it once, use it forever. A good function is a tool you can pick up again and again — that is how big programs stay small.
