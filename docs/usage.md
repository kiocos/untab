# Using Untab

With the library focused, press **⌘V** (macOS) or **Ctrl+V** (Windows/Linux):

- An HTTP(S) URL becomes a bookmark; saving it again highlights the existing item
- Plain text becomes an editable note
- A copied image becomes an image file
- Files copied in your file manager become owned attachments

You can also drag files onto the window or use the paperclip button. Paste inside search and edit fields works normally. A URL pointing to a PDF or video stays a link; to keep the actual file, import the downloaded file.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Paste and save | ⌘V | Ctrl+V |
| Search | ⌘K | Ctrl+K |
| Add link | ⌘N | Ctrl+N |
| New note | ⌘⇧N | Ctrl+Shift+N |

Use collections, favorites and type filters to organize the grid. New items go into the selected collection. Search matches titles, URLs and note contents, ignoring accents.

Open a card to edit it, copy it or open it in your browser/default app. Deleting from the detail panel or the card's hover-only trash button asks for confirmation. **Desfazer** restores the item for ten seconds. Deletion is soft: attachment files remain on disk; there's no automatic purge in this version.

## Backups

**Opções → Exportar backup** creates a portable `.untab` ZIP archive containing active items, collections and original attachments. Preview caches are regenerated. **Importar backup** merges a backup without duplicating existing items. Legacy Untab JSON backups can also be imported.

To move between operating systems, export on one computer and import on the other. Don't copy a live SQLite file; use an exported backup or quit the app before copying its entire data directory. Backups are unencrypted, so store them privately.

## Storage and privacy

| OS | Library directory |
| --- | --- |
| macOS | `~/Library/Application Support/local.untab.app/` |
| Windows | `%APPDATA%\local.untab.app\` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/local.untab.app/` |

The directory contains `untab.sqlite3` and `files/`. Cache is separate in the OS cache directory. Existing macOS installations keep the same application identifier and data paths.

There is no account, telemetry or cloud synchronization. Website preview requests disclose your IP and the requested URL to that website; update checks use GitHub. Previews use public HTML/Open Graph metadata without executing site JavaScript or using your browser cookies. Private-network URLs are stored but not fetched for previews. Offline saving and search work normally.

## Limits

- 2 GB per local file; up to 100 files per import
- 100,000 characters per plain-text note
- 20 GB of attachments per imported backup
- Folders, shortcuts, executables, installers and scripts are rejected; this is not malware scanning
- Archive attachments are stored without extracting or running their content
- Filenames must be portable across supported systems
- PDF/video thumbnails use macOS Quick Look; other platforms show a file card
- Image/video/audio support depends on installed codecs; **Abrir arquivo** uses an external app when needed
