# Publishing a GitHub Release

This repository publishes two release assets:

- `hellobug-<version>-android-release.apk` and its `.sha256` checksum: a release-mode Android APK signed with the configured release key.
- `hellobug-<version>-android-release-debug-signed.apk`: the test fallback when no Android signing secrets are configured.
- `hellobug-daemon-<version>.tar.gz` and its `.sha256` checksum: a portable daemon bundle that installs target-platform production dependencies on first start.

## Before Tagging

1. Update the version in `app/pubspec.yaml`, `packages/daemon/package.json`, and `packages/protocol/package.json`.
2. Run the checks below from the repository root:

   ```bash
   npm --prefix packages test
   npm --prefix packages run build
   cd app && flutter test
   ```

3. Build release assets locally if you want to inspect them before publishing:

   ```bash
   (cd app && flutter build apk --release)
   bash scripts/package-daemon-release.sh <version>
   ```

   The daemon archive and checksum appear in `dist/release/`.

## Publish

The GitHub Actions workflow at `.github/workflows/release.yml` publishes a release when a version tag is pushed. Tags with a prerelease suffix, such as `v0.1.0-debug.1`, are published as GitHub prereleases. If `docs/release-notes/<tag>.md` exists, it is used as the release body; otherwise GitHub generates release notes.

```bash
git tag -a v<version> -m "HelloBug v<version>"
git push origin v<version>
```

It builds both assets and creates the GitHub Release with generated notes.

## Android Signing

Generate the key once on a secure computer, then back up both the `.jks` file and its passwords in a password manager or other secure offline location:

```bash
mkdir -p "$HOME/.hellobug/keys"
keytool -genkeypair -v \
  -keystore "$HOME/.hellobug/keys/hellobug-release.jks" \
  -storetype JKS \
  -alias hellobug \
  -keyalg RSA -keysize 4096 -validity 10000
chmod 600 "$HOME/.hellobug/keys/hellobug-release.jks"
```

`keytool` prompts for the keystore password, key password, and certificate identity. Do not use the debug keystore, and do not lose this key: Android will not accept future updates to the same application ID from a different signing key.

For a local signed build, copy the key to `app/android/hellobug-release.jks` and create `app/android/key.properties`:

```properties
storeFile=hellobug-release.jks
storePassword=<keystore-password>
keyAlias=hellobug
keyPassword=<key-password>
```

Both files are ignored by Git. Build and verify the release APK:

```bash
(cd app && flutter build apk --release)
```

For GitHub Actions, add these four repository secrets under **Settings -> Secrets and variables -> Actions**:

- `ANDROID_KEYSTORE_BASE64`: the single-line Base64 form of the `.jks` file. On macOS: `base64 < hellobug-release.jks | tr -d '\n'`; on Linux: `base64 -w 0 hellobug-release.jks`.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `ANDROID_KEY_PASSWORD`: the key password.
- `ANDROID_KEY_ALIAS`: normally `hellobug` in the command above.

When all four secrets exist, the release workflow writes them only to its ephemeral runner and publishes `hellobug-<version>-android-release.apk`. Otherwise it clearly labels the fallback asset `debug-signed`; that file is suitable only for testing.

## Daemon Distribution

The daemon depends on `node-pty`, which has native platform components. The release archive intentionally does not include `node_modules`; `./start.sh` runs `pnpm install --prod --frozen-lockfile` on the target computer so the correct native dependency is installed. The workspace explicitly permits `node-pty`'s install script. Release users need Node.js 20+ and npm, plus the coding-agent CLI they intend to use.
