# Multilingual blocks

The Blocks canvas can be shown in any of the **80 languages Scratch offers**,
using the same codes and the same native names (`de` Deutsch, `cy` Cymraeg,
`pt-br` Português Brasileiro, `zh-cn` 简体中文, …). The list lives in
`src/shared/languages.ts`.

## What changes, and what doesn't

A language changes the **presentation** of the blocks: the words on them,
the toolbox categories and Blockly's menus. It does **not** change the
program:

- the generated Python is identical in every language;
- MicroPython names, modules and everything sent to or received from the
  board stay in English;
- a dropdown's *label* translates, but the value it stores in the file does
  not, so a program built in Deutsch opens unchanged in English.

The rest of the app's interface (panels, dialogs, Settings) is still English
for now.

## Choosing a language

Three places can set it. The first one that names a language wins:

1. **`?lang=xx` on the web app's address**, e.g.
   `https://app.snakie.org/?lang=fr`. It applies to that visit only and is
   never saved to anyone's settings, so a teacher can hand out a link.
2. **`language:` in the project's `robot.yml`.** The language travels with the
   project, so a starter handed out in Cymraeg opens in Cymraeg on every
   machine. Set it under *Settings ▸ Appearance ▸ Language ▸ This project*, or
   by editing the file.
3. **Settings ▸ Appearance ▸ Language ▸ My language.** English by default, or
   *Match my computer* to follow the operating system's or browser's language.

Arabic, Hebrew, Persian and Sorani mirror the canvas right to left.

## Where the words come from

- **Blockly's stock blocks** (`if`, `repeat`, maths, text, lists, variables,
  functions) and the workspace menus use Blockly's own translation packs
  (`blockly/msg/*`). They cover 67 of the 80 languages. Where Blockly
  has no pack, we fall back the way Scratch does (Aragonés → Español,
  Kreyòl → Français) or to English. The mapping is the `blockly` field in
  `src/shared/languages.ts`. Each pack is its own chunk, downloaded only when
  that language is picked.
- **Snakie's own blocks** (`forever`, hardware, turtle, instruments, …),
  the category names and the sub-drawers come from a catalogue per language
  in `src/renderer/src/lib/blocks/i18n/<code>.json`. German, French and
  Spanish block labels are translated so far. Any key missing from a
  catalogue shows the English, so a catalogue can be partial.

## Adding or improving a translation

A catalogue is a flat JSON object:

| key | what it translates |
| --- | --- |
| `category.<id>` | a toolbox category, e.g. `category.control` |
| `group.<id>` | a sub-drawer, e.g. `group.text-more` |
| `<blockType>.message0` (`message1`, …) | a line on a block's face |
| `<blockType>.tooltip` | the block's tooltip |
| `<blockType>.<FIELD>.<value>` | one dropdown option's label |
| `Msg.<KEY>` | override one of Blockly's own messages |
| `ui.advanced`, `ui.advancedOff` | the toolbox's "Advanced" marker and hint |

Rules:

- **Keep every `%1`, `%2`, … placeholder.** You can reorder them for word
  order, but you can't drop or add one. A translation that breaks this rule is
  ignored at runtime (with a console warning) and fails
  `test/blocksLanguage.test.ts`.
- Leave Python keywords that a block shows on purpose (`class`, `import`,
  `self`, `await`, `with`) in English.
- To start a new language, add its file and one line to `CATALOGUES` in
  `i18n/index.ts`. `englishBlockStrings()` in the same file lists every
  English string that can be translated.

Native speakers' corrections are very welcome. The first German, French and
Spanish catalogues were drafted without a native-speaker review.
