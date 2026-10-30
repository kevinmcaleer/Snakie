- **An embeddable bundle of the parts catalog, Part Editor and wiring canvas
  (#1277).** `npm run build:embed` writes `dist-embed/snakie-parts.js` and
  `snakie-parts.css`: one script exposing `window.SnakieParts`, so another site
  (kevsrobots.com first) can mount `mountCatalog`, `mountPartEditor`,
  `mountWiring` and a read-only `mountPartView` in its own pages. The host passes its own part libraries and
  save callbacks instead of Snakie's file system. The wiring handle can also
  export the canvas as an SVG with its images inlined, and write the BOM and
  pinout tables as Markdown. The bundle carries the `parts.yml` / `robot.yml`
  helpers too. Its CSS is scoped under `.snakie-embed`, so neither page's styles
  touch the other's. The desktop and web builds are unchanged. See
  `docs/embed.md`.
