# macOS code signing & notarization (#47)

Snakie's release workflow signs **and** notarizes the macOS builds **when the
secrets below are present** on the GitHub repo. With no secrets, electron-builder
skips signing (and notarization) and produces the current unsigned builds.

Why it matters:
- **Signing** (Developer ID Application) is what lets the **in-app updater
  install** an update on macOS — Squirrel.Mac validates the signature, so an
  unsigned app fails with `code signature ... did not pass validation`.
- **Notarization** clears the **"Snakie is damaged / can't be opened"**
  Gatekeeper warning on first download (no more `xattr` workaround).

## Prerequisites

- An **Apple Developer Program** membership ($99/yr).
- A **"Developer ID Application"** certificate (created in the Apple Developer
  portal or via Xcode), exported as a **`.p12`** with a password.
- Your **Team ID** (Apple Developer → Membership), an **Apple ID**, and an
  **app-specific password** for that Apple ID (appleid.apple.com → Sign-In &
  Security → App-Specific Passwords).

## GitHub repo secrets to add

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | What it is | How to produce |
| --- | --- | --- |
| `MAC_CSC_LINK` | base64 of the Developer ID **.p12** | `base64 -i Certificates.p12 \| pbcopy` (macOS) and paste |
| `MAC_CSC_KEY_PASSWORD` | the password you set when exporting the .p12 | — |
| `APPLE_ID` | your Apple ID email | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID | appleid.apple.com → App-Specific Passwords |
| `APPLE_TEAM_ID` | your 10-char Team ID | Apple Developer → Membership |

That's it — `release.yml` takes it from there. The notarization secrets
(`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`) go straight to
electron-builder as env, for `mac.notarize` in `electron-builder.yml`. The
entitlements live in `build/entitlements.mac.plist`.

The **certificate** does not: it goes into a keychain the workflow builds itself,
in the *Prepare signing keychain* step, which then exports `CSC_KEYCHAIN`. That is
deliberate, and worth knowing before you change it.

## Why the workflow builds its own keychain (#968)

Left to itself, electron-builder creates a temp keychain and imports the cert —
and macOS releases then failed **intermittently**. v0.51.1 and v0.55.0 each needed
three attempts, always dying on the same command:

```
security set-key-partition-list … SecKeychainUnlock:
  The user name or passphrase you entered is not correct.
```

Not the credentials (they would fail every time) and not the runner image (identical
across the passing and failing runs of a single release). It is a defect in
`app-builder-lib/out/codeSign/macCodeSign.js`, `importCerts`:

```js
security import                 … -P <p12 password>
security set-key-partition-list … -k <p12 password>   // wants the KEYCHAIN's password
```

`-k` is the password `security` falls back to when it has to unlock the keychain
itself. So the wrong one is invisible while the keychain is still unlocked from
`createKeychain`'s earlier `unlock-keychain`, and fatal once anything has relocked
it. What does the relocking on a hosted runner was never established — but it does
not need to be, because passing the keychain's *real* password is correct either
way.

`macPackager.js` only calls `createKeychain` when `CSC_LINK` is set; with it absent
it signs against `process.env.CSC_KEYCHAIN` instead. So the workflow imports the
cert once, in a fixed order, with the right password, and hands electron-builder a
keychain that is already correct. The buggy path is never entered.

Consequences to keep in mind:

- **`CSC_LINK` / `CSC_KEY_PASSWORD` must NOT be set on the build step.** Setting
  either puts electron-builder back on its own keychain path — the bug returns
  silently, as a flake.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` stays off, as before: it disables signing
  outright, and auto-discovery is now exactly how the identity is found.
- With no cert (a fork, secrets unset) the step is a no-op, `CSC_KEYCHAIN` stays
  unset, and the build is unsigned — as it was before.
- The identity is asserted at the end of the step, so a broken cert fails in
  seconds with a clear message instead of twenty minutes later. `-v` requires the
  chain to validate; *Developer ID Certification Authority* ships in macOS's
  `SystemRootCertificates.keychain`, so nothing extra is imported for it.

## Verifying a release is signed & notarized

After tagging a release with the secrets in place, download the dmg and:

```bash
codesign -dv --verbose=4 /Applications/Snakie.app          # shows "Authority=Developer ID Application: …"
spctl -a -vvv -t install /Applications/Snakie.app          # "accepted … source=Notarized Developer ID"
xcrun stapler validate /Applications/Snakie.app            # "The validate action worked!"
```

Then the in-app update flow (#74) will install/relaunch on macOS, and fresh
downloads won't trigger the "damaged" warning.

## Notes

- The **App Store Connect API key** method is an alternative to the Apple ID
  trio (`APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`) — swap the env in
  `release.yml` if you prefer it (avoids the app-specific password).
- **Windows** signing is separate (Authenticode) and not set up here; Windows
  auto-update works unsigned (only SmartScreen warns). **Linux** needs no signing.
