def pick_pin(board, name):
  if name not in board.pins:
    return None
  else:
    return board.pins[name]
