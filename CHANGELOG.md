# Changelog

## 0.4.0 — 2026-10-18

First open-source release. Earlier versions were local development builds.

### Added

- Local library for links, plain-text notes, images, PDFs, video, audio and other files
- Paste, drag and drop, and multiple-file import with owned copies and deduplication
- Dark grid workspace with search, collections, favorites and type filters
- Website metadata, image previews and compatible media playback
- Confirmation before deletion, hover-only card delete button and undo
- Portable backups with attachments, integrity checking and legacy JSON import
- Windows x64 installer with per-user installation, WebView2 setup and uninstaller
- Linux x64 AppImage and Debian packages, plus a universal macOS disk image
- Signed in-app updates for Windows, macOS and Linux AppImage
- Automatic recovery backups before updates, retaining the last three successful copies
- MIT license, installation/development guides and automated platform checks

### Compatibility

- Preserves existing macOS libraries and the `local.untab.app` application identifier
- File clipboard support uses Finder, Windows Explorer and Linux URI lists
- Keyboard hints follow the platform's Command or Control key

### Known limits

- Brazilian Portuguese interface
- PDF/video thumbnails use macOS Quick Look; Windows and Linux show file cards
- Playback depends on system codecs; unsupported formats open in an external app
- macOS packages are ad-hoc signed, without notarization; Windows has no Authenticode certificate
- Draft releases are not offered by the updater until published

Linux WebKitGTK has an [upstream limitation with local media URLs](https://github.com/tauri-apps/tauri/issues/3725). When playback fails, **Abrir arquivo** opens the saved original in your system player. Saving, organizing and exporting those files still work.
