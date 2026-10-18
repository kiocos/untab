# Security

Security fixes target the latest published release. Update when a fix is available.

Please report vulnerabilities privately using [GitHub's security advisory form](https://github.com/kiocos/untab/security/advisories/new). Include the affected version, OS, reproduction steps and impact. Don't post private files, credentials or working exploits in public issues.

Untab stores an unencrypted local SQLite database and attachment files. Use OS disk encryption if needed. Metadata fetching blocks private-network addresses, but opening a bookmark deliberately uses your browser. Executable checks reduce accidental imports; they are not an antivirus scanner. Archives are stored without unpacking their content.

The updater verifies signed artifacts before installation. Its signing key is separate from the maintainer's PGP commit key and from OS distribution certificates.

## Known dependency advisory

The Linux GTK 3 dependency tree includes `glib 0.18.5`, affected by [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), an unsound string iterator that can crash. The corrected `glib 0.20` API is incompatible with the GTK 3 version used by Tauri. Source review found no calls to `Variant::array_iter_str` in Untab or its GTK/WebKit/Tauri integration; this is a reachability assessment, not a formal security audit. Keep the dependency alert visible and reassess when that stack changes. Windows and macOS do not build this dependency.
