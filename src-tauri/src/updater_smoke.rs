use crate::{archive, db::AppResult, files, prepare_update, AppState, Database};
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

pub fn setup(app: &mut tauri::App) {
    assert_eq!(std::env::var("CI").as_deref(), Ok("true"));
    let report =
        PathBuf::from(std::env::var_os("UNTAB_UPDATER_REPORT").expect("Isolated report path"));
    let app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = exercise(&app, &report).await {
            let _ = fs::write(&report, serde_json::json!({"error": error}).to_string());
            app.exit(1);
        }
    });
}

async fn exercise(app: &tauri::AppHandle, report: &std::path::Path) -> AppResult<()> {
    let state = app.state::<AppState>();
    if !state.db.library()?.bookmarks.is_empty() {
        return Err("Updater test requires an empty CI library".into());
    }
    let collection = state.db.create_collection("Update test", "#987abc")?;
    let link = state
        .db
        .add("https://example.com/keep-this-link", Some(&collection))?;
    state.db.apply_metadata(&link.id, None)?;
    state.db.favorite(&link.id, true)?;
    state.db.create_note(
        "Keep my note",
        "Conteúdo que não pode desaparecer",
        Some(&collection),
    )?;
    for (name, bytes) in [
        (
            "image.svg",
            include_bytes!("../../qa/fixtures/workspace.svg").as_slice(),
        ),
        (
            "document.pdf",
            include_bytes!("../../qa/fixtures/document.pdf").as_slice(),
        ),
        (
            "clip.mp4",
            include_bytes!("../../qa/fixtures/clip.mp4").as_slice(),
        ),
        (
            "audio.wav",
            include_bytes!("../../qa/fixtures/audio.wav").as_slice(),
        ),
        ("data.txt", b"User-owned attachment".as_slice()),
    ] {
        let file = files::store_reader(&state.files, name, bytes)?;
        state.db.add_file(&file, Some(&collection), None)?;
    }
    let expected = state.db.library()?;
    let endpoint = std::env::var("UNTAB_UPDATER_ENDPOINT").map_err(|e| e.to_string())?;
    if !endpoint.starts_with("http://127.0.0.1:") {
        return Err("Only the isolated loopback server is permitted".into());
    }
    for manifest in ["tampered.json", "wrong-version.json"] {
        let update = app
            .updater_builder()
            .endpoints(vec![format!("{endpoint}/{manifest}")
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?])
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Missing test update")?;
        if update.download(|_, _| {}, || {}).await.is_ok() {
            return Err(format!("Accepted unsafe update: {manifest}"));
        }
    }
    let directory = state.files.parent().unwrap().join("update-backups");
    fs::write(&directory, b"Simulated unwritable backup directory").map_err(|e| e.to_string())?;
    if prepare_update(app.clone()).await.is_ok() {
        return Err("Accepted failed backup".into());
    }
    fs::remove_file(&directory).map_err(|e| e.to_string())?;
    let backup = prepare_update(app.clone()).await?;
    let restore = tempfile::tempdir().map_err(|e| e.to_string())?;
    let restore_files = restore.path().join("files");
    fs::create_dir(&restore_files).map_err(|e| e.to_string())?;
    let restored = Database::open(&restore.path().join("library.sqlite3"))?;
    if archive::import(&restored, &restore_files, std::path::Path::new(&backup))?
        != expected.bookmarks.len()
    {
        return Err("Incomplete recovery backup".into());
    }
    for item in &expected.bookmarks {
        if let Some(file) = &item.attachment {
            if fs::read(files::resolve(&restore_files, file)?).map_err(|e| e.to_string())?
                != fs::read(files::resolve(&state.files, file)?).map_err(|e| e.to_string())?
            {
                return Err("Restored attachment differs".into());
            }
        }
    }
    let update = app
        .updater_builder()
        .endpoints(vec![format!("{endpoint}/latest.json")
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Missing valid update")?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    fs::write(
        report,
        serde_json::json!({
            "stage": "installing", "from": app.package_info().version.to_string(),
            "to": update.version, "backup": backup, "expected": expected,
            "tamperedRejected": true, "wrongVersionRejected": true, "failedBackupRejected": true,
            "backupRestored": true
        })
        .to_string(),
    )
    .map_err(|e| e.to_string())?;
    update.install(bytes).map_err(|e| e.to_string())
}
