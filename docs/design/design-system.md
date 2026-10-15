# The Snakie design system

Why this exists, the rules that settle open questions, and the three passes
that get Snakie from today's hand-styled CSS to one token set and one component
library that both skins share. Same approach as NoodlePlanner's design system.

| | |
|---|---|
| Is light as usable as dark? Measured. | [`theme-parity-audit.md`](theme-parity-audit.md) |
| Every screen, and every UI pattern with its copy count | [`ui-inventory.md`](ui-inventory.md) |
| Raw numbers | [`token-audit-data.json`](token-audit-data.json), [`audit/rendered-contrast.json`](audit/rendered-contrast.json) |
| Side-by-side screenshots (light \| dark) | [`audit/screens/`](audit/screens/) |

## 1. The problem

Snakie's UI was built feature by feature without a design framework. The
audit put numbers on it: 114 stylesheets, 2,482 raw colour literals, two
overlapping token families, 49 separate button implementations — and a light
skin that fails WCAG AA on 115 text elements against dark's 43.

## 2. Principles

**Tokens first, then components.** A button is an assembly of tokens. Settle
colour, type, spacing, radius, elevation and motion first; components reference
them.

**Both skins are first-class.** Every token that carries colour has a light and
a dark value, designed together and checked together. Neither skin is the base
the other patches. A surface that is deliberately the same in both (Board View
mat, console, block palette, gold active state) is declared a *fixed surface*
and gets its own ink tokens, so it is a decision, not an accident.

**This is a re-skin, not a migration.** Rebuild each component once against
the fixed tokens. Don't walk old values forward one by one; old arbitrary
values are abandoned as components are rebuilt.

**Penpot holds the tokens; Storybook holds the components.** Tokens are
designed in Penpot (Tokens Studio JSON in `docs/design/tokens/`, a Light and a
Dark theme) and the CSS token block is generated from that export. If a
component or variant is not in Storybook, it is not official.

**Never hardcode a colour, font or spacing value.** Reference a token. If no
token fits, stop and flag it. Enforced by a lint ratchet in pass 3.

## 3. The three passes

### Pass 1 — Audit (this PR)

Measure before deciding anything.

- Rendered light/dark contrast across 15 screens (`npm run design:rendered`)
- Token pairing contrast in both skins (`npm run design:contrast`)
- Token, hardcoded-value and theme-scoping inventory (`npm run design:audit`)
- Screen map and pattern tally ([`ui-inventory.md`](ui-inventory.md))

### Pass 2 — Tokens and components in Penpot and Storybook

1. **Decide the token set.** One family (Soft Shell as the survivor; legacy
   chrome tokens aliased, then removed). Semantic roles: surfaces, text ramp,
   accents, status, borders (including `--border-control` ≥ 3:1), focus, plus
   fixed-surface inks. Scales: type, spacing (4px base), radius, elevation,
   z-index, motion.
2. **Fix the ramps so both skins pass.** Every text-on-surface pairing clears
   4.5:1 in both skins before anything is built on it.
3. **Export to Penpot.** `docs/design/tokens/` — `core.json`,
   `color-light.json`, `color-dark.json`, `$themes.json`, `$metadata.json` —
   imported into a "Snakie Design System" Penpot file with Light and Dark themes.
   Generate the CSS token block from it (`npm run design:tokens`, with `--check` in CI).
4. **Map components in Penpot.** One board per pattern in
   [`ui-inventory.md`](ui-inventory.md) §3's order, every variant and state,
   in both themes.
5. **Set up Storybook** with a theme switcher that sets `data-theme`, token
   swatch stories (light/dark pairs), and a story per canonical component and
   variant. Build order: button, segmented control, panel header, dialog,
   badge/chip, empty state, input/select, notice, tooltip, tabs, tree row, card,
   instrument chrome.

### Pass 3 — Replace hardcoded values with tokens and components

1. **Ratchet.** `npm run lint:design` fails a PR that adds a raw colour, font
   size, font family or off-scale spacing value; a committed baseline holds
   today's counts and may only go down.
2. **Contrast gate.** `npm run design:contrast` in CI; no baseline — a failing
   pairing fails the build.
3. **Migrate screen by screen**, worst parity first: Help, Flash firmware,
   notice stack, Settings, Electronics, part editor, instruments, then the rest.
   Each PR swaps bespoke markup for canonical components, deletes the old CSS,
   and re-runs the rendered audit for that screen.
4. **TS/TSX colours** (canvas, three.js, Monaco, xterm, PDF) read from the
   resolved tokens rather than literals.
5. **Remove the 685 literal `var()` fallbacks** once every token is generated.

Done when: both skins pass the rendered audit with zero AA failures on every
screen, `lint:design` baseline is zero, and every component in the inventory
has a Storybook story.

## 4. Vocabulary

- **Token** — a named design value (`--panel`, `--space-8`).
- **Semantic token** — a role (`--text-muted`), resolved per skin from a
  primitive (`--stone-600`).
- **Fixed surface** — deliberately identical in both skins, with its own inks.
- **Canonical component** — the one implementation of a pattern, in Storybook.
