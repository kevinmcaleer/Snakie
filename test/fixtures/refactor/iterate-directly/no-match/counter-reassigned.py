"""The counter is moved by hand inside the body, so `xs[i]` is not the item."""


def skip_blanks(rows):
    for i in range(len(rows)):
        if not rows[i]:
            i = i + 1
        print(rows[i])


def step_over(frames, stride):
    for i in range(len(frames)):
        i += stride
        print(frames[i])
