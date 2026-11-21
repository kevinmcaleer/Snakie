- **Switch between MicroPython and CircuitPython from the status bar.** The
  runtime item in the status bar is now a menu. On the simulator it switches the
  simulator itself between MicroPython and CircuitPython, live, and the help,
  completions, Run/Reset wording and file badges follow (#764). With nothing
  connected it picks the Python to write for. On a real board it sets which
  Python the help and completions teach (the same setting as the Help panel's
  pills), and offers to put the other Python on the board or try it on the
  simulator instead. On phones the switcher now comes first in the status bar.
