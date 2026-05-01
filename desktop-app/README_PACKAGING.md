# Packaging

## macOS

MoltTree uses Electron Builder for macOS packaging. The packaging flow is:

1. Build the Electron app into `out/`.
2. Regenerate the macOS icon from `packaging/icons/app-icon-source.png`.
3. Build universal macOS `dist/MoltTree-<version>-universal.dmg` and `dist/MoltTree-<version>-universal.zip`.
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

## Windows

MoltTree uses Electron Builder's NSIS target for Windows packaging. The Windows build uses the transparent renderer icon at `src/renderer/assets/default-app-icon.png` so the executable icon does not render as a hard white square. Windows release builds are signed through Azure Artifact Signing with Electron Builder's `win.azureSignOptions`.

Run:

```bash
npm run dist:win --workspace desktop-app
```

For local Windows signing, authenticate with Azure CLI first and export the Artifact Signing values:

```bash
export ARTIFACT_SIGNING_ENDPOINT="https://eus.codesigning.azure.net/"
export ARTIFACT_SIGNING_ACCOUNT="glass-signing-prod"
export ARTIFACT_SIGNING_PROFILE="glass-certificate"
```

The first Windows target is x64. Add more Windows architectures only after deciding whether the extra installer size is worth it.

## Icons

Keep the checked-in macOS icon source image here:

```text
packaging/icons/app-icon-source.png
```

Regenerate icons with:

```bash
npm run icons:mac --workspace desktop-app
```

The script uses macOS `sips` and `iconutil` to write `packaging/macos/generated-icons/icon.icns`, `packaging/macos/generated-icons/dmg-background.png`, and `packaging/macos/generated-icons/dmg-background@2x.png`. That generated directory is ignored and should be recreated before packaging. Windows packaging uses the PNG icon directly.

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

The macOS release assets must include `latest-mac.yml`, the `.dmg`, the `.zip`, and blockmaps. The `.zip` target must stay enabled because the macOS updater uses it. The `.dmg` is for direct install downloads. Windows release assets must include `latest.yml`, the `.exe`, and blockmaps.

## Values To Decide Before Public Release

- Confirm `appId` in `electron-builder.config.cjs`; changing it after public release will look like a different app to macOS and Windows.
- Make sure `package.json` `version` is the release version before pushing a release commit.

## GitHub Actions

`../.github/workflows/build-desktop-installers.yml` builds the macOS and Windows installers on pushes to `main` and manual dispatch.

The workflow reads `desktop-app/package.json` and uses `v<version>` as the release tag. If that GitHub Release already exists, the installer builds are skipped. Otherwise, macOS and Windows installers build in parallel, upload GitHub Actions artifacts, and a final release job waits for both builds before publishing the GitHub Release.

If the matching GitHub Release does not exist yet, the workflow requires Apple signing secrets and Windows signing secrets, creates the `v<version>` tag on the current commit when needed, then publishes the signed and notarized macOS release assets and the Windows installer to `glassdevtools/molttree` GitHub Releases. It also uploads `MoltTree.dmg` and `MoltTree.exe` aliases for website downloads. If the tag already exists on a different commit, the workflow fails so that a package version cannot silently point at two different builds.

GitHub release uploads use the built-in `${{ github.token }}` as `GH_TOKEN`; no repository secret is needed for that token.

macOS signing requires the certificate secrets plus one notarization mode.

| Secret                        | Required            | Value                                                                                                                     |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`           | macOS               | Base64 encoded `.p12` export of the `Developer ID Application` certificate. Electron Builder receives this as `CSC_LINK`. |
| `APPLE_CERTIFICATE_PASSWORD`  | macOS               | Password for the `.p12` certificate export. Electron Builder receives this as `CSC_KEY_PASSWORD`.                         |
| `APPLE_API_KEY`               | macOS API key mode  | App Store Connect API key id. The workflow writes this to `APPLE_API_KEY_ID` after decoding the `.p8` file.               |
| `APPLE_API_ISSUER`            | macOS API key mode  | App Store Connect issuer id.                                                                                              |
| `APPLE_API_KEY_P8_BASE64`     | macOS API key mode  | Base64 encoded contents of `AuthKey_<APPLE_API_KEY>.p8`.                                                                  |
| `APPLE_ID`                    | macOS Apple ID mode | Apple ID email for notarization.                                                                                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS Apple ID mode | App-specific password for the Apple ID.                                                                                   |
| `APPLE_TEAM_ID`               | macOS Apple ID mode | Apple Developer team id.                                                                                                  |

Windows signing requires all Azure Artifact Signing secrets.

The Azure federated identity credential used by `azure/login` must match this workflow's GitHub OIDC token:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `api://AzureADTokenExchange`
- Subject: `repo:glassdevtools/molttree:ref:refs/heads/main`

| Secret                      | Required | Value                                                                       |
| --------------------------- | -------- | --------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`           | Windows  | Azure app registration client id used by `azure/login`.                     |
| `AZURE_TENANT_ID`           | Windows  | Azure tenant id for the app registration.                                   |
| `AZURE_SUBSCRIPTION_ID`     | Windows  | Azure subscription id used by `azure/login`.                                |
| `ARTIFACT_SIGNING_ENDPOINT` | Windows  | Trusted Signing endpoint, for example `https://eus.codesigning.azure.net/`. |
| `ARTIFACT_SIGNING_ACCOUNT`  | Windows  | Trusted Signing account name, for example `glass-signing-prod`.             |
| `ARTIFACT_SIGNING_PROFILE`  | Windows  | Certificate profile name, for example `glass-certificate`.                  |

The Azure app registration must have a GitHub Actions federated credential and the `Trusted Signing Certificate Profile Signer` role on the certificate profile. The configured Windows publisher name is `Glass Devtools, Inc.`, which must match the certificate Common Name exactly.

Release command:

```bash
npm version patch --workspace desktop-app --no-git-tag-version
git add desktop-app/package.json package-lock.json
git commit -m "Release vX.Y.Z"
git push origin main
```

Replace `X.Y.Z` with the new `desktop-app/package.json` version. The workflow creates and pushes `vX.Y.Z` during the signed release build.
