# Packaging

## macOS

MoltTree uses Electron Builder for macOS packaging. The packaging flow is:

1. Build the Electron app into `out/`.
2. Regenerate the macOS icon from `packaging/macos/assets/icon-source.png`.
3. Build `dist/MoltTree-<version>-<arch>.dmg` and `dist/MoltTree-<version>-<arch>.zip`.
4. Code sign and notarize when signing and Apple credentials are available.

Run:

```bash
npm run dist:mac
```

For a local unsigned package while testing the bundle shape:

```bash
npm run build
npm run icons:mac
npx electron-builder --config electron-builder.config.cjs --mac dir -c.mac.identity=null -c.mac.notarize=false
```

## Icons

Keep the checked-in source image here:

```text
packaging/macos/assets/icon-source.png
```

Regenerate icons with:

```bash
npm run icons:mac
```

The script writes `packaging/macos/generated-icons/icon.icns` and `packaging/macos/generated-icons/icon.png`. That generated directory is ignored and should be recreated before packaging, matching the `wgpu-test-4` source-image-to-generated-icons pattern.

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

The app uses `electron-updater` in packaged builds. Electron Builder writes the update config into the app when `MOLTTREE_UPDATE_BASE_URL` is set during packaging:

```bash
export MOLTTREE_UPDATE_BASE_URL="https://updates.example.com/molttree/macos"
npm run dist:mac
```

Upload the macOS update files from `dist/` to that URL:

```text
latest-mac.yml
MoltTree-<version>-<arch>.dmg
MoltTree-<version>-<arch>.zip
*.blockmap
```

The `.zip` target must stay enabled because the macOS updater uses it. The `.dmg` is for direct install downloads.

## Values To Decide Before Public Release

- Confirm `appId` in `electron-builder.config.cjs`; changing it after public release will look like a different app to macOS.
- Choose the permanent update host and set `MOLTTREE_UPDATE_BASE_URL` in release builds.
- Add a release publishing job once the host is chosen.

## GitHub Actions

`.github/workflows/build-macos-installer.yml` builds the macOS installer on pushes to `main`, version tags, and manual dispatch.

The workflow always uploads the generated `dist/MoltTree-*.dmg`, `dist/MoltTree-*.zip`, and blockmaps as a GitHub Actions artifact. If the Apple signing secrets are missing, it builds an unsigned artifact for CI testing. If all Apple signing secrets are present, it signs and notarizes the app before uploading it.

Required secrets for signed builds:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_API_KEY
APPLE_API_ISSUER
APPLE_API_KEY_P8_BASE64
```

Optional repository variable for update metadata:

```text
MOLTTREE_UPDATE_BASE_URL
```
