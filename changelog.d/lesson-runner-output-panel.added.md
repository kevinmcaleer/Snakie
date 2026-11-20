- **The lesson runner: press play and the output pops up under the code.**
  `SnakieEmbed.runner(pre, opts)` keeps a page's plain code block as it is and
  opens a small output panel under it (`embed.html?output=1`) that runs the
  code in the browser: the output in a live REPL you can keep typing into,
  and the board with its pins lit while the simulator drives them. The panel
  has Run again / Stop and a close button, and tells the page when it starts
  and stops, so the page's own play button can turn into stop. It loads no
  editor, so it opens quickly. kevsrobots.com lessons use it for their new
  green play button.
