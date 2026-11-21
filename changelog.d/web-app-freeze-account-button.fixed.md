- **The web app no longer freezes when the toolbar re-renders.** The browser
  stand-in for the desktop bridge handed out a new `window.api.kevsrobots`
  object on every read, so the account button's effects re-ran on every render
  and looped. It now returns the same object each time.
