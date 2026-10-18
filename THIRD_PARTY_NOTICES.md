# Third-party software

Untab's own code and original icon/illustrations use the MIT license in `LICENSE`.

Dependencies retain their own licenses. Exact versions are recorded in `Cargo.lock` and `package-lock.json`; their source packages contain the applicable copyright and license notices. `THIRD_PARTY_LICENSES.txt` collects those notices and is included in installed packages. Regenerate it with `node scripts/licenses.mjs` after changing dependencies.

| Component | License | Source |
| --- | --- | --- |
| Tauri and official plugins | MIT / Apache-2.0 | https://github.com/tauri-apps |
| React | MIT | https://github.com/facebook/react |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| SQLite | Public domain | https://sqlite.org/copyright.html |
| rusqlite | MIT | https://github.com/rusqlite/rusqlite |
| reqwest | MIT / Apache-2.0 | https://github.com/seanmonstar/reqwest |
| GTK and GLib | LGPL-2.1-or-later | https://gitlab.gnome.org/GNOME |
| WebKitGTK | LGPL / BSD | https://webkitgtk.org |
| GStreamer | LGPL-2.1-or-later | https://gstreamer.freedesktop.org |

Windows uses Microsoft's WebView2 runtime; macOS uses the system WebKit framework. Linux packages use the distribution's GTK/WebKitGTK and media libraries; AppImage bundles runtime libraries selected by Tauri/linuxdeploy. Those libraries are not relicensed under MIT. The build workflow records the Ubuntu package versions used for each release.

The presentation acknowledges T3 Code, Excalidraw and Linkwarden as inspiration. Their application code and artwork are not included. Demo illustrations, the silent audio/video clip and the minimal PDF fixture were created for this repository.
