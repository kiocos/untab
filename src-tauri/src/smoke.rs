use std::path::PathBuf;
use tauri::Listener;

pub fn data_directory() -> std::io::Result<PathBuf> {
    let dir = std::env::var_os("UNTAB_SMOKE_DIR").ok_or_else(|| {
        std::io::Error::other("Defina UNTAB_SMOKE_DIR para uma biblioteca de teste")
    })?;
    Ok(PathBuf::from(dir))
}

pub fn setup(app: &mut tauri::App) {
    let fixtures = data_directory().unwrap().join("sources");
    std::fs::create_dir_all(&fixtures).unwrap();
    if !fixtures.join("image.png").exists() {
        image::RgbaImage::from_pixel(120, 80, image::Rgba([140, 120, 180, 255]))
            .save(fixtures.join("image.png"))
            .unwrap();
        for (name, bytes) in [
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
            ("data.json", b"{\"message\":\"documento local\"}".as_slice()),
            ("blocked.exe", b"MZexecutable".as_slice()),
        ] {
            std::fs::write(fixtures.join(name), bytes).unwrap();
        }
    }
    let handle = app.handle().clone();
    app.listen("smoke-result", move |event| {
        println!("UNTAB_SMOKE_RESULT={}", event.payload());
        let success = serde_json::from_str::<serde_json::Value>(event.payload())
            .ok()
            .and_then(|value| value.get("success").and_then(|v| v.as_bool()))
            .unwrap_or(false);
        handle.exit(if success { 0 } else { 1 });
    });
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(110)).await;
        eprintln!("UNTAB_SMOKE_TIMEOUT");
        handle.exit(1);
    });
}

pub fn fixtures_script() -> String {
    let root = data_directory().unwrap().join("sources");
    let paths: Vec<_> = [
        "image.png",
        "document.pdf",
        "clip.mp4",
        "audio.wav",
        "data.json",
        "blocked.exe",
    ]
    .iter()
    .map(|name| root.join(name).to_string_lossy().into_owned())
    .collect();
    format!(
        "window.__untabSmokeFiles={};window.__untabSmokePlatform={};window.__untabSmokeClipboard={};",
        serde_json::to_string(&paths).unwrap(),
        serde_json::to_string(std::env::consts::OS).unwrap(),
        std::env::var("CI").is_ok_and(|value| value == "true")
    )
}
