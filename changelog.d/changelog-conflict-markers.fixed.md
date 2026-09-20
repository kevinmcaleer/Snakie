- **Take the committed merge-conflict markers out of the changelog.** A
  `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/master` block had been committed
  unresolved into `[Unreleased]` and shipped on `master`, wrapping about 130
  lines of entries. Both sides were real entries and both are kept; only the
  three marker lines go. `npm run changelog -- check` now fails on unresolved
  markers in `CHANGELOG.md` or a fragment, so this cannot ship again — while
  still ignoring the `` `<<<<<<<` `` an entry quotes on purpose.
