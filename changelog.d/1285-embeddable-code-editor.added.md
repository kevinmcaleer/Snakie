- **Embeddable code editor for tutorials (#1285, #1286, #1287, #1288, #1289).**
  `app.snakie.org/embed.html?gist=<id>&file=main.py` (or `?repo=owner/name&path=…`)
  shows a gist or repo file in Snakie's editor, with Code / Split / Blocks views
  and a REPL that runs it in the reader's browser, for other sites to iframe. It
  replaces trinket.io. URL options choose the view, the blocks toolbox, a
  read-only viewer, autorun, the theme, a line range and the height. The footer
  links to the code on GitHub and to **Open in Snakie**, which opens the same
  file (with the reader's edits) in a new tab of the full app. `engine=pyodide`
  runs full CPython (numpy, pandas, matplotlib plots) in the same box, loaded
  from jsDelivr on the first Run. `snakie-embed.js` turns a
  `<div data-snakie-gist="…">` into the iframe and sizes it to fit. See
  `docs/embed-code.md`.
