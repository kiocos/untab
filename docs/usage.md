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

Use the grid/list buttons beside the sort control to choose a view. Untab remembers your choice when you reopen the app. Collections, favorites, type filters and search work in both views. New items go into the selected collection. Search matches titles, URLs and note contents, ignoring accents.

Left-click a card or list row to open a link in your browser, a file in its default app, or a note in the editor. Right-click an item (or press **Shift+F10** while it is focused) for its context menu: edit details, copy, favorite, refresh a web preview or delete. File menus also include **Salvar como…** and **Abrir local do arquivo**, which reveals the saved copy in your file manager. Use **Editar detalhes** to change the title or collection and view previews.

Deleting from the menu, detail panel or an item's trash button asks for confirmation. **Desfazer** restores the item for ten seconds. Deletion is soft: attachment files remain on disk; there's no automatic purge in this version.

## Backups

**Opções → Exportar backup** creates a portable `.untab` ZIP archive containing active items, collections and original attachments. Preview caches are regenerated. **Importar backup** merges a backup without duplicating existing items. Legacy Untab JSON backups can also be imported.

To move between operating systems, export on one computer and import on the other. Don't copy a live SQLite file; use an exported backup or quit the app before copying its entire data directory. Backups are unencrypted, so store them privately.

Before an in-app update, Untab saves a complete `.untab` archive in `update-backups/` inside the library directory. It keeps the three most recent successful automatic backups. If the backup fails, the update is cancelled; check free space, permissions and attachment integrity before retrying. The same 20 GB archive limit applies. Manual installation does not trigger this backup, so export one first.

To recover items, open **Opções → Importar backup** and select an archive from `update-backups/`. Import merges items and does not overwrite existing notes with older content. For a complete return to an earlier library, quit Untab, move the current library directory to a safe location, reopen the app and import the archive into the empty library. There is no automatic rollback of an installed version.

These copies share your disk. Export a backup to another device or your own backup service to protect against disk failure, theft or accidental deletion of the entire library. Untab does not provide cloud recovery.

## Storage and privacy

| OS | Library directory |
| --- | --- |
| macOS | `~/Library/Application Support/local.untab.app/` |
| Windows | `%APPDATA%\local.untab.app\` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/local.untab.app/` |

The directory contains `untab.sqlite3` and `files/`. Cache is separate in the OS cache directory. Existing macOS installations keep the same application identifier and data paths.

SQLite uses transactions, WAL journaling and full synchronous writes. Imported originals are copied into owned storage before their database records are saved. Portable backups validate attachment hashes and replace the destination only after a complete write. These measures reduce corruption risk; they cannot guarantee against every hardware, filesystem or software failure.

There is no account, telemetry or cloud synchronization. Website preview requests disclose your IP and the requested URL to that website; update checks use GitHub. Previews use public HTML/Open Graph metadata without executing site JavaScript or using your browser cookies. Private-network URLs are stored but not fetched for previews. Offline saving and search work normally.

The library is not encrypted by Untab. On macOS/Linux, the library and preview directories are restricted to their owner; Windows uses the permissions inherited from your user profile. Software running as your user, or with administrator privileges, can still read these files. Use OS account security and disk encryption when needed. Imported files are not executed by the app; opening one in an external application uses that application's security controls.

## Limits

- 2 GB per local file; up to 100 files per import
- 100,000 characters per plain-text note
- Backups: 20 GB of attachments, 25 MB of metadata, 50,000 items and 5,000 collections
- Folders, shortcuts, executables, installers and scripts are rejected; this is not malware scanning
- Archive attachments are stored without extracting or running their content
- Filenames must be portable across supported systems
- PDF/video thumbnails use macOS Quick Look; other platforms show a file card
- Image/video/audio support depends on installed codecs; **Abrir arquivo** uses an external app when needed

Linux WebKitGTK has an [upstream limitation with local media URLs](https://github.com/tauri-apps/tauri/issues/3725). When playback fails, **Abrir arquivo** opens the saved original in your system player. Saving, organizing and exporting those files still work.
