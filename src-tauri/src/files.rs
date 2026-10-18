use crate::db::AppResult;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub path: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub sha256: String,
}

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn kind(name: &str) -> &'static str {
    match extension(name).as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "heif" | "avif" | "bmp" | "tif"
        | "tiff" | "svg" | "ico" => "image",
        "mp4" | "m4v" | "mov" | "webm" | "mkv" | "avi" | "mpeg" | "mpg" => "video",
        "mp3" | "m4a" | "wav" | "aac" | "flac" | "ogg" | "aiff" | "opus" => "audio",
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "csv" | "xls" | "xlsx" | "ods"
        | "ppt" | "pptx" | "pages" | "numbers" | "key" | "epub" => "document",
        _ => "file",
    }
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn reserved_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

pub fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || name.len() > 255
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || reserved_name(name)
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
        })
    {
        return Err("Nome de arquivo inválido".into());
    }
    if [
        "app",
        "exe",
        "com",
        "msi",
        "msix",
        "bat",
        "cmd",
        "ps1",
        "sh",
        "bash",
        "zsh",
        "command",
        "run",
        "bin",
        "dmg",
        "pkg",
        "mpkg",
        "deb",
        "rpm",
        "appimage",
        "jar",
        "scr",
        "dll",
        "dylib",
        "so",
        "workflow",
        "scpt",
        "scptd",
        "applescript",
        "vbs",
        "vbe",
        "js",
        "jse",
        "wsf",
        "hta",
        "py",
        "pyc",
        "rb",
        "pl",
        "php",
        "lnk",
        "url",
        "desktop",
        "webloc",
        "inetloc",
    ]
    .contains(&extension(name).as_str())
    {
        return Err("Executáveis, instaladores e scripts não são aceitos".into());
    }
    Ok(())
}

pub fn validate_metadata(file: &Attachment) -> AppResult<()> {
    validate_name(&file.name)?;
    if file.sha256.len() != 64
        || !file
            .sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || file.path != format!("{}/{}", file.sha256, file.name)
        || file.size > MAX_FILE_SIZE
        || file.mime.len() > 128
    {
        return Err("Dados de arquivo inválidos".into());
    }
    Ok(())
}

fn validate_header(bytes: &[u8]) -> AppResult<()> {
    if bytes.starts_with(b"MZ")
        || bytes.starts_with(b"\x7fELF")
        || bytes.starts_with(b"#!")
        || [
            b"\xfe\xed\xfa\xce",
            b"\xce\xfa\xed\xfe",
            b"\xfe\xed\xfa\xcf",
            b"\xcf\xfa\xed\xfe",
            b"\xca\xfe\xba\xbe",
            b"\xbe\xba\xfe\xca",
            b"\xca\xfe\xba\xbf",
            b"\xbf\xba\xfe\xca",
        ]
        .iter()
        .any(|magic| bytes.starts_with(*magic))
    {
        return Err("O conteúdo deste arquivo é executável".into());
    }
    Ok(())
}

pub fn resolve(root: &Path, file: &Attachment) -> AppResult<PathBuf> {
    validate_metadata(file)?;
    let path = root
        .join(&file.path)
        .canonicalize()
        .map_err(|_| "O arquivo local não foi encontrado".to_string())?;
    let root = root.canonicalize().map_err(error)?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("Caminho de arquivo inválido".into());
    }
    Ok(path)
}

pub fn validate_open(path: &Path, name: &str) -> AppResult<()> {
    validate_name(name)?;
    let metadata = fs::symlink_metadata(path).map_err(error)?;
    if !metadata.is_file() {
        return Err("Selecione arquivos, não pastas ou atalhos".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 != 0 {
            return Err("Arquivos executáveis não são aceitos".into());
        }
    }
    let mut header = [0u8; 8];
    let count = File::open(path)
        .map_err(error)?
        .read(&mut header)
        .map_err(error)?;
    validate_header(&header[..count])
}

pub fn store_path(root: &Path, path: &Path) -> AppResult<Attachment> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nome de arquivo inválido")?;
    validate_open(path, name)?;
    let file = File::open(path).map_err(error)?;
    if file.metadata().map_err(error)?.len() > MAX_FILE_SIZE {
        return Err("O limite é 2 GB por arquivo".into());
    }
    store_reader(root, name, file)
}

pub fn store_reader(root: &Path, name: &str, mut reader: impl Read) -> AppResult<Attachment> {
    validate_name(name)?;
    fs::create_dir_all(root).map_err(error)?;
    let mut temp = tempfile::NamedTempFile::new_in(root).map_err(error)?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 65536];
    let mut header = Vec::new();
    loop {
        let n = reader.read(&mut buffer).map_err(error)?;
        if n == 0 {
            break;
        }
        if header.len() < 8 {
            header.extend_from_slice(&buffer[..n.min(8 - header.len())]);
        }
        size += n as u64;
        if size > MAX_FILE_SIZE {
            return Err("O limite é 2 GB por arquivo".into());
        }
        hash.update(&buffer[..n]);
        temp.write_all(&buffer[..n]).map_err(error)?;
    }
    validate_header(&header)?;
    let sha256 = format!("{:x}", hash.finalize());
    let relative = format!("{sha256}/{name}");
    let directory = root.join(&sha256);
    fs::create_dir_all(&directory).map_err(error)?;
    let destination = directory.join(name);
    if !destination.exists() {
        temp.persist_noclobber(&destination).map_err(error)?;
    }
    let mime = match extension(name).as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "txt" | "md" => "text/plain",
        _ => "application/octet-stream",
    }
    .to_string();
    Ok(Attachment {
        path: relative,
        name: name.to_owned(),
        mime,
        size,
        sha256,
    })
}

#[cfg(target_os = "macos")]
pub fn thumbnail(path: &Path, cache: &Path, hash: &str) -> Option<String> {
    let name = format!("file-{hash}.png");
    if cache.join(&name).is_file() {
        return Some(name);
    }
    if !matches!(kind(path.to_str()?), "image" | "video" | "document") {
        return None;
    }
    let dir = tempfile::tempdir().ok()?;
    let mut child = Command::new("/usr/bin/qlmanage")
        .args(["-t", "-s", "800", "-o"])
        .arg(dir.path())
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(8) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let preview = fs::read_dir(dir.path())
        .ok()?
        .filter_map(Result::ok)
        .find(|e| e.path().extension().is_some_and(|ext| ext == "png"))?;
    if preview.metadata().ok()?.len() > 10 * 1024 * 1024 {
        return None;
    }
    fs::copy(preview.path(), cache.join(&name)).ok()?;
    Some(name)
}

#[cfg(not(target_os = "macos"))]
pub fn thumbnail(path: &Path, cache: &Path, hash: &str) -> Option<String> {
    if kind(path.to_str()?) != "image" {
        return None;
    }
    let name = format!("file-{hash}.png");
    if cache.join(&name).is_file() {
        return Some(name);
    }
    let mut reader = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(10000);
    limits.max_image_height = Some(10000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .ok()?
        .thumbnail(800, 800)
        .save(cache.join(&name))
        .ok()?;
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_owned_copy_and_blocks_executables_and_traversal() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.txt");
        fs::write(&source, "Um documento com acentos").unwrap();
        let library = root.path().join("files");
        let file = store_path(&library, &source).unwrap();
        fs::remove_file(&source).unwrap();
        assert_eq!(
            fs::read_to_string(resolve(&library, &file).unwrap()).unwrap(),
            "Um documento com acentos"
        );
        let copy = store_reader(
            &library,
            "source.txt",
            "Um documento com acentos".as_bytes(),
        )
        .unwrap();
        assert_eq!(file.sha256, copy.sha256);
        for name in [
            "installer.pkg",
            "SCRIPT.SH",
            "../test.pdf",
            "x.app",
            "x.exe",
            "x.command",
            "CON.txt",
            "lpt1.pdf",
            "COM¹.txt",
            "report.pdf ",
            "image.png.",
            "report?.txt",
        ] {
            assert!(store_reader(&library, name, &b"text"[..]).is_err());
        }
        for bytes in [
            &b"MZhidden"[..],
            &b"\x7fELFtest"[..],
            &b"\xcf\xfa\xed\xfetest"[..],
            &b"#!/bin/sh"[..],
        ] {
            assert!(store_reader(&library, "disguised.pdf", bytes).is_err());
        }
        let mut invalid = file.clone();
        invalid.path = "../../secret".into();
        assert!(resolve(&library, &invalid).is_err());
    }
}
