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

That's it — `release.yml` passes these to electron-builder
(`CSC_LINK`/`CSC_KEY_PASSWORD` for signing; `APPLE_ID`/
`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` for notarization via
`mac.notarize: true` in `electron-builder.yml`). The entitlements live in
`build/entitlements.mac.plist`.

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
