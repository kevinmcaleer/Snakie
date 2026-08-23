"""A `for` leaks its target; a comprehension does not."""


def label_pins(pins):
    labels = []
    for pin in pins:
        labels.append(str(pin))
    print("last pin scanned:", pin)
    return labels
