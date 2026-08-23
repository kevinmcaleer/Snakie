import ujson


def save_state(state):
  with open("state.json", "w") as f:
    f.write(ujson.dumps(state))


def load_state():
  with open("state.json") as f:
    return ujson.loads(f.read())
