import ujson


def save_state(state):
  f = open("state.json", "w")
  f.write(ujson.dumps(state))
  f.close()


def load_state():
  f = open("state.json")
  try:
    return ujson.loads(f.read())
  finally:
    f.close()
