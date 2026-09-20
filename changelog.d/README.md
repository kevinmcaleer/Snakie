# changelog.d — one file per change

`CHANGELOG.md` used to be edited by every branch at once, always in the same
place inside `[Unreleased]`. Git can merge that locally (`.gitattributes` marks
the file `merge=union`), but **GitHub's server-side merge ignores
`.gitattributes` merge drivers**, so every pull request showed a CHANGELOG
conflict and nothing could be merged from the web UI.

So branches no longer write to `CHANGELOG.md`. Each change drops a **new file**
in here instead. New files with distinct names never conflict.

## Adding an entry

```bash
npm run changelog -- new added "Detect firmware modules" --issue 1246
```

That writes `changelog.d/1246-detect-firmware-modules.added.md`. Open it and
write the entry — the same prose style the changelog has always used:

```markdown
- **Detect the modules baked into a board's firmware (#1246).** Snakie could
  only ever see two kinds of module: …
```

Write it by hand if you prefer; only the filename shape matters:

    <issue>-<slug>.<type>.md     e.g. 1246-detect-firmware-modules.added.md
    <slug>.<type>.md             e.g. tidy-status-bar.fixed.md

`<type>` is one of `added`, `changed`, `deprecated`, `removed`, `fixed`,
`security` — the Keep a Changelog sections. The body is markdown bullets,
copied into the release section verbatim.

## Seeing what's pending

```bash
npm run changelog -- preview
```

Renders the section the next release would get, fragments grouped under their
headings in Keep a Changelog order.

## Cutting a release

```bash
npm run changelog -- release 0.86.0
```

Folds every fragment **and** anything still sitting in `[Unreleased]` into a
new dated `[0.86.0]` section, merging duplicate `###` headings, leaves a fresh
empty `[Unreleased]`, updates the compare links at the bottom, and deletes the
fragment files. Review the diff, then carry on with the release steps in
`CLAUDE.md` (version bump, tag, push).

## CI

The `changelog` job in `.github/workflows/ci.yml` asks every pull request that
touches shipping code to carry an entry. Label the PR `no changelog` to skip it
— a pure refactor or a CI tweak doesn't need one.

A branch that still edits `CHANGELOG.md` directly passes the check, with a
notice: the guard is there to catch a *missing* entry, not to strand the pull
requests that were open when fragments arrived. Prefer a fragment; the direct
edit is the thing that conflicts.
