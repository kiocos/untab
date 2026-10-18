# Security

Security fixes target the latest published release. Update when a fix is available.

Please report vulnerabilities privately using [GitHub's security advisory form](https://github.com/kiocos/untab/security/advisories/new). Include the affected version, OS, reproduction steps and impact. Don't post private files, credentials or working exploits in public issues.

Untab stores an unencrypted local SQLite database and attachment files. Use OS disk encryption if needed. Metadata fetching blocks private-network addresses, but opening a bookmark deliberately uses your browser. Executable checks reduce accidental imports; they are not an antivirus scanner. Archives are stored without unpacking their content.

The updater verifies signed artifacts before installation. Its signing key is separate from the maintainer's PGP commit key and from OS distribution certificates.
