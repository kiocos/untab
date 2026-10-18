# Install, update and uninstall

Get the package for your system from [Releases](https://github.com/kiocos/untab/releases). Source code is available under “Source code” on the same page. A draft is visible only to repository collaborators and isn't a public download yet.

## macOS

Open the universal `.dmg` and drag **Untab** into **Applications**. Launch it from Spotlight or Applications. Supports Apple Silicon and Intel on macOS 12 or newer.

This first release is ad-hoc signed, not Apple-notarized. After downloading from this repository and checking the checksum, if Gatekeeper blocks it, follow Apple's **System Settings → Privacy & Security → Open Anyway** flow. Don't disable Gatekeeper globally.

To uninstall, quit Untab and move `Untab.app` to Trash. Your library stays in Application Support.

## Windows

Run the x64 `-setup.exe`. Installation is for the current user, under `%LOCALAPPDATA%\Untab`, with a Start menu shortcut. Administrator access is not normally required. The installer downloads WebView2 if it's missing, so that first setup needs an internet connection. Windows 10/11 are supported.

The installer isn't Authenticode-signed yet. SmartScreen may show an unknown-publisher warning. Check that the file came from this repository and verify its SHA-256 before choosing to run it. Managed computers may require approval from their administrator.

Uninstall using **Settings → Apps → Installed apps → Untab → Uninstall**. The uninstaller removes application files and shortcuts. Leave **Delete application data** unchecked to keep your library. Selecting it explicitly removes the library and cache. WebView2 is shared with other apps and is retained.

## Linux

Packages target x64 Linux with glibc 2.35 or newer, such as Ubuntu 22.04+. Other distributions need compatible GTK 3 and WebKitGTK 4.1 libraries. Local audio/video may need your system player because of a WebKitGTK limitation. Wayland/X11 behavior can vary by desktop; file picker and drag and drop are alternatives if your file manager doesn't advertise clipboard URI lists.

### AppImage

Save the `.AppImage` in a writable folder, such as `~/Applications`, enable **Allow executing file as program** in its properties, then open it. Alternatively:

```sh
chmod +x Untab_*.AppImage
./Untab_*.AppImage
```

The AppImage requires FUSE 2 support. On Ubuntu 22.04 install `libfuse2`; on Ubuntu 24.04 install `libfuse2t64`. If FUSE is unavailable, `./Untab_*.AppImage --appimage-extract-and-run` can launch it, but use the normal AppImage launch for in-app updates.

To uninstall, delete the AppImage and any launcher you created. Your library remains in your data directory.

### Debian / Ubuntu

```sh
sudo apt install ./Untab_*_amd64.deb
```

Launch Untab from your application menu. Install a newer `.deb` with the same command to update; this package does not self-update. To uninstall:

```sh
sudo apt remove untab
```

## Updates and data

The app checks for a published release at startup. **Atualizações** checks again and shows an available version. Choose **Atualizar e reiniciar** to download, verify its signature, install and restart. It doesn't install updates without your confirmation. Windows shows installer progress; Linux self-updates require an AppImage in a writable location. Draft releases are never offered.

Before downloading an update, Untab creates a complete recovery backup and cancels installation if that backup fails. The last three automatic copies stay in `update-backups/` inside the library directory. Installation replaces the app, keeping its data directory. Manual installation requires exporting your own backup first. [Recovery steps and backup limits](usage.md#backups).

Downloads use HTTPS and require a valid signature from the updater key embedded in the application. The signed version must match the manifest version, preventing an older signed package from being advertised as a new one. This signature is separate from PGP commit signing and Apple/Windows publisher certificates. It does not prove that a signed release has no bugs, and it depends on the maintainer keeping the private signing key and build environment secure.

Each release includes `SHA256SUMS.txt` and a PGP signature. Compare a downloaded file using `shasum -a 256 filename` on macOS, `sha256sum filename` on Linux, or `Get-FileHash filename -Algorithm SHA256` in PowerShell. To verify the checksum list's PGP signature, import the maintainer's public key from [GitHub](https://github.com/kiocos.gpg), check its fingerprint, then run `gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt`.

Initial release signing fingerprint: `0633 21B4 5A06 1642 A478 51C0 7FFA A112 EC01 919A`.
