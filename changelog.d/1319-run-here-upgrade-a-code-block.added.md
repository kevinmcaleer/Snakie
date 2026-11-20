- **Run here: a plain code block can become a live code box in place
  (#1319).** `SnakieEmbed.upgrade(pre, { name, board })` in `snakie-embed.js`
  takes a page's own `<pre><code>` block, shows it in the Snakie box where it
  stood and runs it. Its `unmount()` puts the block back. A page with hundreds
  of code blocks can stay plain and load an editor only when a reader asks.
