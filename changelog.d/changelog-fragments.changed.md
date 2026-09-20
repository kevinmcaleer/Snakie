- **Changelog entries are now one file per change.** Every branch used to append
  to the same place in `CHANGELOG.md`, so nearly every pull request conflicted
  there. `.gitattributes` marks the file `merge=union`, which resolves it
  locally — but GitHub's server-side merge ignores `.gitattributes` merge
  drivers, so the web UI reported a conflict anyway and the merge button stayed
  dead. Branches now drop a new file in `changelog.d/` instead
  (`npm run changelog -- new added "…" --issue N`); distinct new files never
  conflict. `CHANGELOG.md` is written only when a release is cut, by
  `npm run changelog -- release X.Y.Z`, which folds the fragments and anything
  still sitting in `[Unreleased]` into one dated section, merges the duplicate
  headings that union merges left behind, and updates the compare links. CI asks
  a pull request touching shipping code for a fragment unless it is labelled
  `no changelog`.
