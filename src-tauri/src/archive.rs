use crate::{
    db::{AppResult, Backup, Database},
    files::{self, Attachment},
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn export(db: &Database, files: &Path, destination: &Path) -> AppResult<()> {
    let backup = db.backup()?;
    if backup.bookmarks.len() > 50_000 || backup.collections.len() > 5_000 {
        return Err("A biblioteca excede os limites do formato de backup".into());
    }
    let manifest = serde_json::to_vec(&backup).map_err(error)?;
    if manifest.len() > 25 * 1024 * 1024 {
        return Err("O manifesto do backup excede 25 MB".into());
    }
    if backup
        .bookmarks
        .iter()
        .filter_map(|b| b.attachment.as_ref())
        .map(|f| f.size)
        .sum::<u64>()
        > 20 * 1024 * 1024 * 1024
    {
        return Err("O backup excede 20 GB".into());
    }
    let parent = destination.parent().ok_or("Destino inválido")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    {
        let mut archive = ZipWriter::new(&mut temp);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .large_file(true);
        archive.start_file("library.json", options).map_err(error)?;
        archive.write_all(&manifest).map_err(error)?;
        let mut included = HashSet::new();
        for item in &backup.bookmarks {
            if let Some(file) = &item.attachment {
                if included.insert(&file.path) {
                    let path = files::resolve(files, file)?;
                    archive
                        .start_file(format!("files/{}", file.path), options)
                        .map_err(error)?;
                    let mut source = File::open(path).map_err(error)?;
                    let mut hash = Sha256::new();
                    let mut size = 0;
                    let mut buffer = [0u8; 65536];
                    loop {
                        let count = source.read(&mut buffer).map_err(error)?;
                        if count == 0 {
                            break;
                        }
                        size += count as u64;
                        if size > file.size {
                            break;
                        }
                        hash.update(&buffer[..count]);
                        archive.write_all(&buffer[..count]).map_err(error)?;
                    }
                    if size != file.size || format!("{:x}", hash.finalize()) != file.sha256 {
                        return Err(format!("{} foi alterado fora do Untab; adicione o arquivo novamente antes de exportar", file.name));
                    }
                }
            }
        }
        archive.finish().map_err(error)?;
    }
    temp.flush().map_err(error)?;
    temp.as_file().sync_all().map_err(error)?;
    temp.persist(destination).map_err(error)?;
    #[cfg(unix)]
    File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(error)?;
    Ok(())
}

pub fn before_update(db: &Database, files: &Path, directory: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(directory).map_err(error)?;
    let destination = directory.join(format!(
        "pre-update-{}-{}.untab",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ"),
        uuid::Uuid::new_v4()
    ));
    export(db, files, &destination)?;
    let mut previous: Vec<_> = fs::read_dir(directory)
        .map_err(error)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path != &destination
                && path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|name| name.starts_with("pre-update-") && name.ends_with(".untab"))
        })
        .collect();
    previous.sort();
    for path in previous.iter().take(previous.len().saturating_sub(2)) {
        let _ = fs::remove_file(path);
    }
    Ok(destination)
}

pub fn import(db: &Database, files: &Path, source: &Path) -> AppResult<usize> {
    let input = File::open(source).map_err(error)?;
    if source
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        if input.metadata().map_err(error)?.len() > 25 * 1024 * 1024 {
            return Err("O backup JSON excede 25 MB".into());
        }
        let backup: Backup = serde_json::from_reader(input).map_err(|_| "Backup inválido")?;
        if backup.bookmarks.iter().any(|b| b.attachment.is_some()) {
            return Err("Use o backup .untab que contém os arquivos".into());
        }
        return db.import(backup);
    }
    let mut archive = ZipArchive::new(input).map_err(|_| "Backup inválido")?;
    let backup: Backup = {
        let manifest = archive.by_name("library.json").map_err(error)?;
        if manifest.size() > 25 * 1024 * 1024 {
            return Err("Manifesto do backup muito grande".into());
        }
        serde_json::from_reader(manifest.take(25 * 1024 * 1024 + 1))
            .map_err(|_| "Backup inválido")?
    };
    if backup.bookmarks.len() > 50_000 {
        return Err("Backup muito grande".into());
    }
    let staging = tempfile::tempdir_in(files).map_err(error)?;
    let mut staged: Vec<Attachment> = Vec::new();
    let mut total = 0u64;
    for item in &backup.bookmarks {
        if let Some(file) = &item.attachment {
            files::validate_metadata(file)?;
            total = total.checked_add(file.size).ok_or("Backup muito grande")?;
            if total > 20 * 1024 * 1024 * 1024 {
                return Err("O backup excede 20 GB".into());
            }
            let entry = archive
                .by_name(&format!("files/{}", file.path))
                .map_err(|_| format!("Arquivo ausente no backup: {}", file.name))?;
            if entry.size() != file.size
                || entry
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o111 != 0 || mode & 0o170000 == 0o120000)
            {
                return Err("Arquivo inválido no backup".into());
            }
            let stored =
                files::store_reader(staging.path(), &file.name, entry.take(file.size + 1))?;
            if stored.sha256 != file.sha256 || stored.size != file.size {
                return Err("Um arquivo do backup está corrompido".into());
            }
            staged.push(stored);
        }
    }
    let mut created = Vec::new();
    let result = (|| {
        for file in staged {
            let destination = files.join(&file.path);
            if destination.exists() {
                continue;
            }
            fs::create_dir_all(destination.parent().ok_or("Caminho inválido")?).map_err(error)?;
            fs::rename(staging.path().join(&file.path), &destination).map_err(error)?;
            created.push(destination);
        }
        db.import(backup)
    })();
    if result.is_err() {
        for path in created {
            let _ = fs::remove_file(path);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_backups_restore_and_rotate_only_after_success() {
        let root = tempfile::tempdir().unwrap();
        let files = root.path().join("files");
        let directory = root.path().join("update-backups");
        fs::create_dir(&files).unwrap();
        let db = Database::open(&root.path().join("library.sqlite")).unwrap();
        db.add("https://example.com/saved", None).unwrap();
        db.create_note("Keep", "Important note", None).unwrap();
        let file = files::store_reader(&files, "data.txt", &b"original"[..]).unwrap();
        db.add_file(&file, None, None).unwrap();
        let mut latest = PathBuf::new();
        for _ in 0..4 {
            latest = before_update(&db, &files, &directory).unwrap();
        }
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 3);
        let restored = Database::open(&root.path().join("restore.sqlite")).unwrap();
        let restored_files = root.path().join("restored-files");
        fs::create_dir(&restored_files).unwrap();
        assert_eq!(import(&restored, &restored_files, &latest).unwrap(), 3);
        assert_eq!(
            fs::read(files::resolve(&restored_files, &file).unwrap()).unwrap(),
            b"original"
        );
        let original_backup = fs::read(&latest).unwrap();
        fs::write(files::resolve(&files, &file).unwrap(), b"corrupt!").unwrap();
        assert!(before_update(&db, &files, &directory).is_err());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 3);
        assert_eq!(fs::read(latest).unwrap(), original_backup);
        assert_eq!(db.library().unwrap().bookmarks.len(), 3);
    }
    #[test]
    fn portable_backup_restores_files_notes_and_collections_without_duplicates() {
        let root = tempfile::tempdir().unwrap();
        let files = root.path().join("files");
        fs::create_dir(&files).unwrap();
        let db = Database::open(&root.path().join("first.sqlite")).unwrap();
        let collection = db.create_collection("Documentos", "#123456").unwrap();
        let file = files::store_reader(&files, "documento.pdf", &b"%PDF-1.4\ncontent"[..]).unwrap();
        let added = db.add_file(&file, Some(&collection), None).unwrap();
        db.favorite(&added.id, true).unwrap();
        db.create_note("", "Nota com acentos", None).unwrap();
        let backup = root.path().join("backup.untab");
        export(&db, &files, &backup).unwrap();
        fs::remove_dir_all(&files).unwrap();
        let target = root.path().join("restored");
        fs::create_dir(&target).unwrap();
        let restored = Database::open(&root.path().join("second.sqlite")).unwrap();
        assert_eq!(import(&restored, &target, &backup).unwrap(), 2);
        assert_eq!(import(&restored, &target, &backup).unwrap(), 0);
        assert_eq!(
            fs::read(files::resolve(&target, &file).unwrap()).unwrap(),
            b"%PDF-1.4\ncontent"
        );
        let item = restored
            .library()
            .unwrap()
            .bookmarks
            .into_iter()
            .find(|b| b.attachment.is_some())
            .unwrap();
        assert!(item.favorite && item.collection_id.is_some());
        assert!(restored.pending().unwrap().is_empty());
        let original_backup = fs::read(&backup).unwrap();
        fs::write(
            files::resolve(&target, &file).unwrap(),
            "changed externally",
        )
        .unwrap();
        assert!(export(&restored, &target, &backup).is_err());
        assert_eq!(fs::read(&backup).unwrap(), original_backup);
    }

    #[test]
    fn rejects_corrupt_archive_without_importing_metadata_or_files() {
        let root = tempfile::tempdir().unwrap();
        let files = root.path().join("files");
        fs::create_dir(&files).unwrap();
        let source = Database::open(&root.path().join("source.sqlite")).unwrap();
        let file = files::store_reader(&files, "text.txt", &b"original"[..]).unwrap();
        source.add_file(&file, None, None).unwrap();
        let archive_path = root.path().join("corrupt.untab");
        let mut writer = ZipWriter::new(File::create(&archive_path).unwrap());
        writer
            .start_file("library.json", SimpleFileOptions::default())
            .unwrap();
        serde_json::to_writer(&mut writer, &source.backup().unwrap()).unwrap();
        writer
            .start_file(format!("files/{}", file.path), SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"modified").unwrap();
        writer.finish().unwrap();
        let target_files = root.path().join("target");
        fs::create_dir(&target_files).unwrap();
        let target = Database::open(&root.path().join("target.sqlite")).unwrap();
        assert!(import(&target, &target_files, &archive_path).is_err());
        assert!(target.library().unwrap().bookmarks.is_empty());
        assert_eq!(fs::read_dir(target_files).unwrap().count(), 0);
    }
}
