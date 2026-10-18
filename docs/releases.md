# Releasing

The project uses SemVer and Conventional Commits. Versions before `0.4.0` were private local builds. Keep this process small: one signed tag, three native build jobs, one reviewed draft.

## Once per repository

- Keep the updater private key in a password manager or offline backup, outside this repository
- Configure GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and, if applicable, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Keep only the updater public key in `src-tauri/tauri.conf.json`
- Configure the maintainer's PGP key for signed commits and tags

The updater key is separate from PGP and OS certificates. Losing it prevents trusted updates to existing installations. Never replace it during an ordinary version bump. No Apple notarization or Windows Authenticode credentials are configured for the first release.

## Each release

1. Update `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json` to the same version; update `CHANGELOG.md` and regenerate dependency notices with `node scripts/licenses.mjs`
2. Run the checks, make focused PGP-signed commits (`git commit -S`), then create and push a signed tag (`git tag -s vX.Y.Z -m 'Untab X.Y.Z'`)
3. Run **Build release** in Actions, selecting the signed tag as the ref; branch builds can validate installers before tagging, but only reuse artifacts when their workflow commit exactly matches the final tag
4. Download the three `release-*` workflow artifacts into a single directory
5. Run `node scripts/prepare-release.mjs <directory>` to validate the artifacts and generate `latest.json` and `SHA256SUMS.txt`
6. Sign the checksum list with `gpg --armor --detach-sign <directory>/SHA256SUMS.txt`
7. Create a **draft** release for the tag, copy that version's changelog into its notes and attach all packages, update archives, `.sig` files, `latest.json` and checksum files
8. Check downloads, signatures and install/uninstall behavior before publishing the draft

GitHub automatically supplies source ZIP/tar archives for the tag. The workflow produces macOS universal `.dmg` and update `.app.tar.gz`, Windows x64 NSIS `.exe`, and Linux x64 `.AppImage`/`.deb`. It never publishes a release automatically.

The updater reads `https://github.com/kiocos/untab/releases/latest/download/latest.json`. That endpoint starts serving a version only after its draft is published. A clean offline/error state is expected before the first publication. Both Mac architectures use the universal update archive; Linux package-manager installs are updated through the package manager.

Keep the initial `local.untab.app` identifier to preserve existing user data. Installers and updates must not reset the library. The Windows uninstaller offers an explicit data-removal checkbox; leaving it unchecked preserves data.
