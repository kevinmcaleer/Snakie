- **Light/dark parity audit (#1273, epic #1272).** Pass 1 of the design-system
  work measures how usable each skin is. `npm run design:rendered` opens the
  web build in both skins, screenshots 15 screens side by side and scores every
  piece of text against the pixels behind it; `npm run design:contrast` checks
  the theme tokens in both skins; `npm run design:audit` inventories tokens,
  hardcoded values and UI pattern sprawl. Findings are in
  `docs/design/theme-parity-audit.md`: the light skin fails WCAG AA on 115 text
  elements against dark's 43.
