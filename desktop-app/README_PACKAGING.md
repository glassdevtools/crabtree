# Packaging

## macOS

MoltTree uses Electron Builder for macOS packaging. The packaging flow is:

1. Build the Electron app into `out/`.
2. Regenerate the macOS icon from `src/renderer/assets/default-app-icon.png`.
3. Build `dist/MoltTree-<version>-<arch>.dmg` and `dist/MoltTree-<version>-<arch>.zip`.
4. Code sign and notarize when signing and Apple credentials are available.

Run:

```bash
npm run dist:mac --workspace desktop-app
```

For a local unsigned package while testing the bundle shape:

```bash
cd desktop-app
npm run build
npm run icons:mac
npx electron-builder --config electron-builder.config.cjs --mac dir -c.mac.identity=null -c.mac.notarize=false
```

## Icons

Keep the checked-in source image here:

```text
src/renderer/assets/default-app-icon.png
```

Regenerate icons with:

```bash
npm run icons:mac --workspace desktop-app
```

The script uses macOS `sips` and `iconutil` to write `packaging/macos/generated-icons/icon.icns`, `packaging/macos/generated-icons/dmg-background.png`, and `packaging/macos/generated-icons/dmg-background@2x.png`. That generated directory is ignored and should be recreated before packaging.

## Code Signing And Notarization

Check installed signing identities:

```bash
security find-identity -v -p codesigning
```

For local release signing, install a `Developer ID Application` certificate in your keychain. Electron Builder can use the identity from the keychain, or you can set:

```bash
export CSC_NAME="Developer ID Application: Glass Devtools, Inc. (ZUZ6WG9BCN)"
```

For CI, provide the certificate through Electron Builder's certificate variables:

```bash
export CSC_LINK="base64-or-file-url-for-p12"
export CSC_KEY_PASSWORD="p12-password"
```

For notarization, use one of Electron Builder's supported Apple credential modes.

Keychain profile mode:

```bash
xcrun notarytool store-credentials "MOLTTREE_NOTARY" \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"

export APPLE_KEYCHAIN="$(security default-keychain | tr -d '\"')"
export APPLE_KEYCHAIN_PROFILE="MOLTTREE_NOTARY"
```

App Store Connect API key mode:

```bash
export APPLE_API_KEY="/absolute/path/AuthKey_ABC123XYZ.p8"
export APPLE_API_KEY_ID="ABC123XYZ"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
```

If reusing the `wgpu-test-4` GitHub secrets, note that its `APPLE_API_KEY` value is the key id, while Electron Builder expects `APPLE_API_KEY` to be the path to the `.p8` file. Decode `APPLE_API_KEY_P8_BASE64` to a temp `AuthKey_<id>.p8`, set `APPLE_API_KEY` to that path, and set `APPLE_API_KEY_ID` to the id.

## Auto Updates

The app uses `electron-updater` in packaged builds. Electron Builder writes `app-update.yml` into the packaged app from the GitHub publish config in `electron-builder.config.cjs`.

Release builds publish to:

```text
https://github.com/glassdevtools/molttree/releases
```

This assumes the release assets are public. Do not ship a desktop updater that needs a private GitHub token on user machines.

The release assets must include `latest-mac.yml`, the `.dmg`, the `.zip`, and blockmaps. The `.zip` target must stay enabled because the macOS updater uses it. The `.dmg` is for direct install downloads.

## Values To Decide Before Public Release

- Confirm `appId` in `electron-builder.config.cjs`; changing it after public release will look like a different app to macOS.
- Make sure `package.json` `version` is the release version before tagging.

## GitHub Actions

`../.github/workflows/build-macos-installer.yml` builds the macOS installer on pushes to `main`, version tags, and manual dispatch.

For pushes to `main` and manual dispatches, the workflow uploads the generated `desktop-app/dist/MoltTree-*.dmg`, `desktop-app/dist/MoltTree-*.zip`, and blockmaps as a GitHub Actions artifact. If the Apple signing secrets are missing, it builds an unsigned artifact for CI testing. If all Apple signing secrets are present, it signs and notarizes the app before uploading it.

For `v*` tags, the workflow requires signing secrets, validates that the tag matches `desktop-app/package.json` `version`, then publishes the signed and notarized macOS release assets to `glassdevtools/molttree` GitHub Releases.

Required secrets for signed builds:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
```

Then choose one notarization mode.

App Store Connect API key mode:

```text
APPLE_API_KEY
APPLE_API_ISSUER
APPLE_API_KEY_P8_BASE64
```

Apple ID app-specific password mode:

```text
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

Release command:

```bash
npm version patch --workspace desktop-app --no-git-tag-version
git add desktop-app/package.json package-lock.json
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

Replace `X.Y.Z` with the new `desktop-app/package.json` version.
