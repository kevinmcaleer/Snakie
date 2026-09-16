# When the block you need doesn't exist yet

Sooner or later you will want something no block does. A sensor nobody has
written blocks for. A module you read about. A line from a tutorial.

That is not a wall. At the bottom of the toolbox there is a category called
**Python**, and the blocks in it are grey because they *are* code.

> **import random** — **forever** — **say ( random.randint(1, 6) )** — **wait 500 ms**

A dice, rolling. Nothing in the rest of the palette knows about `random`, and it
did not have to.

## The two blocks doing the work

**`import random`** puts one line at the very top of your program. Hover it and
watch that line light up in the Python — the block is empty where it sits,
because Python wants its imports at the top and Snakie puts them there.

**`random.randint(1, 6)`** is a **Python value block**. It plugs into a socket
like any other value block, except that what is inside it is a line of code you
typed yourself.

## Try it

Press **Run**, and watch the numbers arrive in the console.

Then click into the grey block. You get a proper code editor, with the same
autocomplete the big editor has: delete `randint(1, 6)`, type `random.` and look
at the list. Try `random.random()` instead.

## Snakie is watching your typing

Delete the closing bracket and click away. The block gets a **warning badge**,
and it says what is wrong in a sentence. It is not stopping you — the code is
still written into your program exactly as you typed it — but a missing bracket
is much easier to fix when the block tells you than when the board does.

## Why this matters

Everything above the grey blocks is a shortcut for something. These blocks are
the thing itself. The moment you reach for one on purpose, you have stopped
being someone who uses a block editor and started being someone who writes
Python — which is the whole point of the next lesson.
