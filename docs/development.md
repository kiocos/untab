# Development

Use Node.js 22 LTS, Rust 1.90+ and the platform dependencies in the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/). Windows needs the Visual Studio C++ build tools and WebView2. macOS needs Xcode Command Line Tools. Linux needs GTK 3 and WebKitGTK 4.1 development packages.

```sh
npm ci
npm run desktop
```

`npm run dev` starts only Vite; native actions require `npm run desktop`. Development uses the normal library unless you run the isolated native smoke test below.

## Checks

```sh
npm run build
npm test
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npx playwright install chromium
npm run test:ui
```

The Playwright suite uses a controlled native bridge and synthetic demo items, not your library. It covers paste, notes, attachments, collections, confirmation/undo and update flows.

For the actual WebView, Rust commands, SQLite, files and persistence after restart, run:

```sh
npm run test:native
```

This starts Vite if needed and opens a test app with a separate library under `.qa/`, checks the flows and exits. It also fetches a public Open Graph test page, so it needs internet access. On headless Linux use `xvfb-run -a npm run test:native`. The Cargo `smoke-test` feature must never be used in distribution builds.

## Layout

- `src/`: React UI, native command bridge and updater UI
- `src-tauri/src/db.rs`: SQLite migrations and library operations
- `src-tauri/src/files.rs` and `clipboard.rs`: owned attachments, validation, previews and OS clipboard integration
- `src-tauri/src/archive.rs`: portable backups and integrity checks
- `src-tauri/src/metadata.rs`: bounded website metadata fetching
- `qa/`: UI and native smoke tests with original fixtures
- `design/icon.svg`: original icon source

To build locally without release signing, override artifact generation:

```sh
npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

PowerShell users can put that JSON into a temporary config file and pass its path with `--config`. Outputs are under `src-tauri/target/release/bundle/`. Builds run on their target OS; release automation also builds a universal Mac binary. On memory-limited machines set `CARGO_BUILD_JOBS=2`.

See [releasing](releases.md) for signed updates and draft releases.
