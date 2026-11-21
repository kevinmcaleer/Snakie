- **Code embeds start sooner and say they're starting.** A page's plain code
  block now stays in place with a small green "Starting Snakie…" badge until
  the box has something to show, so there's no blank moment. The box shows
  the code straight away, in the editor's layout, while the editor itself
  (several MB) downloads, and that download starts alongside the program
  instead of after it. `snakie-embed.js` also opens the connection to Snakie
  as the page loads and starts a box 1200px before it scrolls into view
  (was 400px).
