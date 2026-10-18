use crate::db::AppResult;
use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
pub fn paths(_app: &tauri::AppHandle) -> Vec<PathBuf> {
    paths_from_pasteboard(&objc2_app_kit::NSPasteboard::generalPasteboard())
}

#[cfg(target_os = "macos")]
fn paths_from_pasteboard(board: &objc2_app_kit::NSPasteboard) -> Vec<PathBuf> {
    use objc2_foundation::ns_string;
    let Some(items) = board.pasteboardItems() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| item.stringForType(ns_string!("public.file-url")))
        .filter_map(|s| url::Url::parse(&s.to_string()).ok()?.to_file_path().ok())
        .collect()
}

#[cfg(target_os = "macos")]
pub fn pdf() -> Option<Vec<u8>> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::ns_string;
    let data = NSPasteboard::generalPasteboard().dataForType(ns_string!("com.adobe.pdf"))?;
    if data.len() > 100 * 1024 * 1024 {
        return None;
    }
    Some(data.to_vec())
}

#[cfg(target_os = "macos")]
pub fn copy_file(_app: &tauri::AppHandle, path: &Path) -> AppResult<()> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{ns_string, NSString};
    let url = url::Url::from_file_path(path).map_err(|_| "Caminho inválido")?;
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    if !board.setString_forType(
        &NSString::from_str(url.as_str()),
        ns_string!("public.file-url"),
    ) {
        return Err("Não foi possível copiar o arquivo".into());
    }
    Ok(())
}

#[cfg(windows)]
pub fn paths(_app: &tauri::AppHandle) -> Vec<PathBuf> {
    clipboard_win::get_clipboard::<Vec<String>, _>(clipboard_win::formats::FileList)
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

#[cfg(windows)]
pub fn copy_file(_app: &tauri::AppHandle, path: &Path) -> AppResult<()> {
    clipboard_win::set_clipboard(
        clipboard_win::formats::FileList,
        &[path.to_string_lossy().as_ref()][..],
    )
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn pdf() -> Option<Vec<u8>> {
    None
}

#[cfg(target_os = "linux")]
pub fn paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let (send, receive) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).request_uris(move |_, uris| {
                let paths = uris
                    .iter()
                    .filter_map(|uri| url::Url::parse(uri).ok()?.to_file_path().ok())
                    .collect();
                let _ = send.send(paths);
            });
        })
        .is_err()
    {
        return Vec::new();
    }
    receive
        .recv_timeout(std::time::Duration::from_secs(3))
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
pub fn copy_file(app: &tauri::AppHandle, path: &Path) -> AppResult<()> {
    let uri = url::Url::from_file_path(path)
        .map_err(|_| "Caminho inválido")?
        .to_string();
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let board = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        let copied = board.set_with_data(
            &[
                gtk::TargetEntry::new("text/uri-list", gtk::TargetFlags::empty(), 0),
                gtk::TargetEntry::new("x-special/gnome-copied-files", gtk::TargetFlags::empty(), 1),
            ],
            move |_, data, info| {
                if info == 0 {
                    data.set_uris(&[&uri]);
                } else {
                    data.set(&data.target(), 8, format!("copy\n{uri}").as_bytes());
                }
            },
        );
        let _ = send.send(copied);
    })
    .map_err(|error| error.to_string())?;
    match receive.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(true) => Ok(()),
        _ => Err("Não foi possível copiar o arquivo".into()),
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn reads_finder_file_urls_without_touching_the_users_clipboard() {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::{ns_string, NSString};
        let board = NSPasteboard::pasteboardWithUniqueName();
        board.setString_forType(
            &NSString::from_str("file:///tmp/Foto%20com%20acentua%C3%A7%C3%A3o.png"),
            ns_string!("public.file-url"),
        );
        assert_eq!(
            paths_from_pasteboard(&board),
            vec![PathBuf::from("/tmp/Foto com acentuação.png")]
        );
        board.clearContents();
        board.setString_forType(
            &NSString::from_str("https://example.com/image.png"),
            ns_string!("public.file-url"),
        );
        assert!(paths_from_pasteboard(&board).is_empty());
        board.clearContents();
    }
}
