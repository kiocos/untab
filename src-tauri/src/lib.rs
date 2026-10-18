mod archive;
mod clipboard;
mod db;
mod files;
mod metadata;
#[cfg(feature = "smoke-test")]
mod smoke;

use db::{Added, AppResult, Database, Library};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct AppState {
    db: Database,
    cache: PathBuf,
    files: PathBuf,
    file_import: Mutex<()>,
    client: reqwest::Client,
    slots: Arc<tokio::sync::Semaphore>,
    jobs: Mutex<HashSet<String>>,
}

fn changed(app: &tauri::AppHandle) {
    let _ = app.emit("library-changed", ());
}

fn enrich(app: &tauri::AppHandle, id: String) {
    let state = app.state::<AppState>();
    if !state
        .jobs
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(id.clone())
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let _permit = state.slots.acquire().await;
        if let Ok(bookmark) = state.db.get(&id) {
            let result = metadata::fetch(&state.client, &bookmark.url, &state.cache, &id)
                .await
                .ok();
            let new_image = result
                .as_ref()
                .and_then(|metadata| metadata.image_path.clone());
            if let Err(error) = state.db.apply_metadata(&id, result) {
                eprintln!("Erro ao salvar prévia: {error}");
                if let Some(name) = new_image {
                    let _ = std::fs::remove_file(state.cache.join(name));
                }
            } else if new_image.is_some() && new_image != bookmark.image_path {
                if let Some(name) = bookmark.image_path {
                    let _ = std::fs::remove_file(state.cache.join(name));
                }
            }
            changed(&app);
        }
        state
            .jobs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&id);
    });
}

fn enrich_pending(app: &tauri::AppHandle) {
    if let Ok(ids) = app.state::<AppState>().db.pending() {
        for id in ids {
            enrich(app, id);
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let Ok(_guard) = state.file_import.lock() else {
            return;
        };
        if let Ok(library) = state.db.library() {
            for item in library.bookmarks {
                if item
                    .image_path
                    .as_ref()
                    .is_some_and(|name| state.cache.join(name).is_file())
                {
                    continue;
                }
                if let Some(file) = item.attachment {
                    if let Ok(path) = files::resolve(&state.files, &file) {
                        if let Some(preview) = files::thumbnail(&path, &state.cache, &file.sha256) {
                            let _ = state.db.file_preview(&item.id, &preview);
                            changed(&app);
                        }
                    }
                }
            }
        }
    });
}

#[tauri::command]
fn get_library(state: State<'_, AppState>) -> AppResult<Library> {
    let mut library = state.db.library()?;
    for bookmark in &mut library.bookmarks {
        bookmark.image_path = bookmark.image_path.as_ref().and_then(|name| {
            let path = state.cache.join(name);
            path.is_file().then(|| path.to_string_lossy().into_owned())
        });
        if let Some(file) = &mut bookmark.attachment {
            file.path = state.files.join(&file.path).to_string_lossy().into_owned();
        }
    }
    Ok(library)
}

#[tauri::command]
fn add_bookmark(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    collection_id: Option<String>,
) -> AppResult<Added> {
    let result = state.db.add(&url, collection_id.as_deref())?;
    if state.db.get(&result.id)?.preview_status == "pending" {
        enrich(&app, result.id.clone());
    }
    changed(&app);
    Ok(result)
}

#[tauri::command]
fn create_note(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    title: String,
    content: String,
    collection_id: Option<String>,
) -> AppResult<Added> {
    let result = state
        .db
        .create_note(&title, &content, collection_id.as_deref())?;
    changed(&app);
    Ok(result)
}

#[tauri::command]
fn edit_note(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    title: String,
    content: String,
    collection_id: Option<String>,
) -> AppResult<()> {
    state
        .db
        .edit_note(&id, &title, &content, collection_id.as_deref())?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn read_clipboard(app: tauri::AppHandle) -> AppResult<String> {
    app.clipboard()
        .read_text()
        .map_err(|_| "O clipboard não contém um link em texto".into())
}

#[derive(Default, serde::Serialize)]
struct CaptureResult {
    items: Vec<Added>,
    errors: Vec<String>,
}

fn save_attachment(
    state: &AppState,
    file: files::Attachment,
    collection_id: Option<&str>,
) -> AppResult<Added> {
    let path = files::resolve(&state.files, &file)?;
    let preview = files::thumbnail(&path, &state.cache, &file.sha256);
    state.db.add_file(&file, collection_id, preview.as_deref())
}

fn capture_paths(
    app: &tauri::AppHandle,
    paths: Vec<PathBuf>,
    collection_id: Option<&str>,
) -> AppResult<CaptureResult> {
    if paths.len() > 100 {
        return Err("Adicione até 100 arquivos por vez".into());
    }
    let state = app.state::<AppState>();
    let _guard = state.file_import.lock().map_err(|e| e.to_string())?;
    let mut result = CaptureResult::default();
    for path in paths {
        match files::store_path(&state.files, &path)
            .and_then(|file| save_attachment(&state, file, collection_id))
        {
            Ok(item) => result.items.push(item),
            Err(error) => result.errors.push(format!(
                "{}: {error}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    changed(app);
    Ok(result)
}

fn capture_text(
    app: &tauri::AppHandle,
    text: &str,
    collection_id: Option<&str>,
) -> AppResult<CaptureResult> {
    let state = app.state::<AppState>();
    let item = if db::normalize_url(text).is_ok() {
        let added = state.db.add(text, collection_id)?;
        if state.db.get(&added.id)?.preview_status == "pending" {
            enrich(app, added.id.clone());
        }
        added
    } else {
        state.db.create_note("", text, collection_id)?
    };
    changed(app);
    Ok(CaptureResult {
        items: vec![item],
        errors: Vec::new(),
    })
}

#[tauri::command]
async fn capture_clipboard(
    app: tauri::AppHandle,
    collection_id: Option<String>,
    text: Option<String>,
) -> AppResult<CaptureResult> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(text) = text {
            return capture_text(&app, &text, collection_id.as_deref());
        }
        let paths = clipboard::paths(&app);
        if !paths.is_empty() {
            return capture_paths(&app, paths, collection_id.as_deref());
        }
        let state = app.state::<AppState>();
        if let Some(pdf) = clipboard::pdf() {
            let _guard = state.file_import.lock().map_err(|e| e.to_string())?;
            let file = files::store_reader(&state.files, "Documento colado.pdf", &pdf[..])?;
            let item = save_attachment(&state, file, collection_id.as_deref())?;
            changed(&app);
            return Ok(CaptureResult {
                items: vec![item],
                errors: Vec::new(),
            });
        }
        if let Ok(image) = app.clipboard().read_image() {
            if u64::from(image.width()) * u64::from(image.height()) > 50_000_000 {
                return Err("A imagem excede 50 megapixels".into());
            }
            let rgba =
                image::RgbaImage::from_raw(image.width(), image.height(), image.rgba().to_vec())
                    .ok_or("Imagem inválida")?;
            let mut encoded = std::io::Cursor::new(Vec::new());
            rgba.write_to(&mut encoded, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            let _guard = state.file_import.lock().map_err(|e| e.to_string())?;
            let file =
                files::store_reader(&state.files, "Imagem colada.png", &encoded.into_inner()[..])?;
            let item = save_attachment(&state, file, collection_id.as_deref())?;
            changed(&app);
            return Ok(CaptureResult {
                items: vec![item],
                errors: Vec::new(),
            });
        }
        let text = app
            .clipboard()
            .read_text()
            .map_err(|_| "O clipboard não contém texto, imagem ou arquivos disponíveis")?;
        capture_text(&app, &text, collection_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_files(
    app: tauri::AppHandle,
    paths: Vec<PathBuf>,
    collection_id: Option<String>,
) -> AppResult<CaptureResult> {
    tauri::async_runtime::spawn_blocking(move || {
        capture_paths(&app, paths, collection_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pick_files(
    app: tauri::AppHandle,
    collection_id: Option<String>,
) -> AppResult<CaptureResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = app
            .dialog()
            .file()
            .set_title("Adicionar arquivos")
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.into_path().map_err(|e| e.to_string()))
            .collect::<AppResult<Vec<_>>>()?;
        capture_paths(&app, paths, collection_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_file(app: tauri::AppHandle, id: String) -> AppResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let file = state
            .db
            .get(&id)?
            .attachment
            .ok_or("Este item não é um arquivo")?;
        let source = files::resolve(&state.files, &file)?;
        let Some(destination) = app
            .dialog()
            .file()
            .set_title("Salvar arquivo")
            .set_file_name(&file.name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let destination = destination.into_path().map_err(|e| e.to_string())?;
        if destination.canonicalize().ok().as_ref() == Some(&source) {
            return Ok(true);
        }
        let mut staged =
            tempfile::NamedTempFile::new_in(destination.parent().ok_or("Destino inválido")?)
                .map_err(|e| e.to_string())?;
        std::io::copy(
            &mut std::fs::File::open(source).map_err(|e| e.to_string())?,
            &mut staged,
        )
        .map_err(|e| e.to_string())?;
        staged.persist(destination).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn reveal_file(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let file = state
        .db
        .get(&id)?
        .attachment
        .ok_or("Este item não é um arquivo")?;
    app.opener()
        .reveal_item_in_dir(files::resolve(&state.files, &file)?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn copy_bookmark(app: tauri::AppHandle, id: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let bookmark = state.db.get(&id)?;
        if let Some(file) = &bookmark.attachment {
            return clipboard::copy_file(&app, &files::resolve(&state.files, file)?);
        }
        app.clipboard()
            .write_text(if bookmark.kind == "note" {
                bookmark.content
            } else {
                bookmark.url
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_bookmark(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let bookmark = state.db.get(&id)?;
    if let Some(file) = &bookmark.attachment {
        let path = files::resolve(&state.files, file)?;
        files::validate_open(&path, &file.name)?;
        return app
            .opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string());
    }
    let url = bookmark.url;
    db::normalize_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn edit_bookmark(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    title: String,
    collection_id: Option<String>,
) -> AppResult<()> {
    state.db.edit(&id, &title, collection_id.as_deref())?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn set_favorite(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<()> {
    state.db.favorite(&id, favorite)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn delete_bookmark(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete(&id)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn restore_bookmark(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    state.db.restore(&id)?;
    enrich_pending(&app);
    changed(&app);
    Ok(())
}

#[tauri::command]
fn refresh_preview(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.mark_pending(&id)?;
    enrich(&app, id);
    changed(&app);
    Ok(())
}

#[tauri::command]
fn create_collection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    color: String,
) -> AppResult<String> {
    let id = state.db.create_collection(&name, &color)?;
    changed(&app);
    Ok(id)
}

#[tauri::command]
fn edit_collection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: String,
) -> AppResult<()> {
    state.db.edit_collection(&id, &name, &color)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn delete_collection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    state.db.delete_collection(&id)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
async fn export_library(app: tauri::AppHandle) -> AppResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = app
            .dialog()
            .file()
            .set_title("Exportar biblioteca")
            .set_file_name(format!(
                "untab-{}.untab",
                chrono::Local::now().format("%Y-%m-%d")
            ))
            .add_filter("Backup do Untab", &["untab"])
            .blocking_save_file();
        let Some(file) = file else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let state = app.state::<AppState>();
        let _guard = state.file_import.lock().map_err(|e| e.to_string())?;
        archive::export(&state.db, &state.files, &path)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_library(app: tauri::AppHandle) -> AppResult<Option<usize>> {
    let cloned = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let file = cloned
            .dialog()
            .file()
            .set_title("Importar biblioteca")
            .add_filter("Backup do Untab", &["untab", "json", "zip"])
            .blocking_pick_file();
        let Some(file) = file else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let state = cloned.state::<AppState>();
        let _guard = state.file_import.lock().map_err(|e| e.to_string())?;
        archive::import(&state.db, &state.files, &path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?;
    if result.is_ok() {
        enrich_pending(&app);
        changed(&app);
    }
    result
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    version: String,
    updater_supported: bool,
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle) -> RuntimeInfo {
    #[cfg(target_os = "linux")]
    let updater_supported = app.env().appimage.is_some();
    #[cfg(not(target_os = "linux"))]
    let updater_supported = true;
    RuntimeInfo {
        version: app.package_info().version.to_string(),
        updater_supported,
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(not(feature = "smoke-test"))]
            let data = app.path().app_data_dir()?;
            #[cfg(feature = "smoke-test")]
            let data = smoke::data_directory()?;
            #[cfg(not(feature = "smoke-test"))]
            let cache = app.path().app_cache_dir()?.join("previews");
            #[cfg(feature = "smoke-test")]
            let cache = data.join("previews");
            std::fs::create_dir_all(&cache)?;
            #[cfg(feature = "smoke-test")]
            app.asset_protocol_scope().allow_directory(&cache, true)?;
            let files = data.join("files");
            std::fs::create_dir_all(&files)?;
            app.asset_protocol_scope().allow_directory(&files, true)?;
            let db = Database::open(&data.join("untab.sqlite3")).map_err(std::io::Error::other)?;
            app.manage(AppState {
                db,
                cache,
                files,
                file_import: Mutex::new(()),
                client: metadata::client().map_err(std::io::Error::other)?,
                slots: Arc::new(tokio::sync::Semaphore::new(4)),
                jobs: Mutex::new(HashSet::new()),
            });
            enrich_pending(app.handle());
            #[cfg(feature = "smoke-test")]
            smoke::setup(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            get_library,
            add_bookmark,
            create_note,
            edit_note,
            read_clipboard,
            capture_clipboard,
            import_files,
            pick_files,
            save_file,
            reveal_file,
            copy_bookmark,
            open_bookmark,
            edit_bookmark,
            set_favorite,
            delete_bookmark,
            restore_bookmark,
            refresh_preview,
            create_collection,
            edit_collection,
            delete_collection,
            export_library,
            import_library
        ]);
    #[cfg(feature = "smoke-test")]
    let builder = builder.on_page_load(|webview, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished {
            let _ = webview.eval(smoke::fixtures_script());
            let _ = webview.eval(include_str!("../../qa/native-smoke.js"));
        }
    });
    builder
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Untab");
}
