use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, sync::Mutex};
use url::Url;
use uuid::Uuid;

pub type AppResult<T> = Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
    pub description: String,
    pub domain: String,
    pub kind: String,
    pub collection_id: Option<String>,
    pub favorite: bool,
    pub image_path: Option<String>,
    pub created_at: i64,
    pub preview_status: String,
    pub content: String,
    #[serde(default)]
    pub attachment: Option<crate::files::Attachment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize)]
pub struct Library {
    pub bookmarks: Vec<Bookmark>,
    pub collections: Vec<Collection>,
}

#[derive(Serialize)]
pub struct Added {
    pub id: String,
    pub duplicate: bool,
}

#[derive(Default, Debug)]
pub struct Metadata {
    pub title: Option<String>,
    pub description: String,
    pub kind: Option<String>,
    pub image_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: u32,
    pub exported_at: i64,
    pub collections: Vec<Collection>,
    pub bookmarks: Vec<BackupBookmark>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupBookmark {
    pub url: String,
    pub title: String,
    pub description: String,
    pub kind: String,
    pub collection_id: Option<String>,
    pub favorite: bool,
    pub created_at: i64,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub attachment: Option<crate::files::Attachment>,
}

pub struct Database(Mutex<Connection>);

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn normalize_url(input: &str) -> AppResult<Url> {
    let input = input.trim();
    if input.is_empty() || input.len() > 16_384 || input.chars().any(char::is_whitespace) {
        return Err("Copie um link válido para colar".into());
    }
    let candidate = if input.contains("://") {
        input.to_owned()
    } else if input.contains('.') && !input.contains(':') && !input.starts_with('/') {
        format!("https://{input}")
    } else {
        return Err("Use um link HTTP ou HTTPS".into());
    };
    let url = Url::parse(&candidate).map_err(|_| "Este link não é válido".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Use um link HTTP ou HTTPS".into());
    }
    Ok(url)
}

pub fn guess_kind(url: &Url) -> &'static str {
    let host = url.host_str().unwrap_or("").trim_start_matches("www.");
    let path = url.path().to_lowercase();
    if ["youtube.com", "youtu.be", "vimeo.com"].contains(&host)
        || host.ends_with(".youtube.com")
        || [".mp4", ".webm", ".mov"]
            .iter()
            .any(|ext| path.ends_with(ext))
    {
        "video"
    } else if [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]
        .iter()
        .any(|ext| path.ends_with(ext))
    {
        "image"
    } else if path.ends_with(".pdf") {
        "document"
    } else {
        "site"
    }
}

fn bookmark_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        domain: row.get(4)?,
        kind: row.get(5)?,
        collection_id: row.get(6)?,
        favorite: row.get(7)?,
        image_path: row.get(8)?,
        created_at: row.get(9)?,
        preview_status: row.get(10)?,
        content: row.get(11)?,
        attachment: row
            .get::<_, Option<String>>(12)?
            .map(|value| {
                serde_json::from_str(&value).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        12,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
            })
            .transpose()?,
    })
}

const BOOKMARK_COLUMNS: &str = "id,url,title,description,domain,kind,collection_id,favorite,image_path,created_at,preview_status,content,attachment";

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(error)?;
        }
        let mut conn = Connection::open(path).map_err(error)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(error)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(error)?;
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(error)?;
        if version > 3 {
            return Err("Esta biblioteca foi criada por uma versão mais recente do Untab".into());
        }
        if version == 0 {
            let tx = conn.transaction().map_err(error)?;
            tx.execute_batch(
                "CREATE TABLE collections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    color TEXT NOT NULL
                );
                CREATE TABLE bookmarks (
                    id TEXT PRIMARY KEY,
                    url TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    domain TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'site',
                    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    image_path TEXT,
                    created_at INTEGER NOT NULL,
                    preview_status TEXT NOT NULL DEFAULT 'pending',
                    title_edited INTEGER NOT NULL DEFAULT 0,
                    deleted_at INTEGER
                );
                CREATE INDEX bookmarks_created ON bookmarks(created_at DESC);
                CREATE INDEX bookmarks_collection ON bookmarks(collection_id);
                PRAGMA user_version=1;",
            )
            .map_err(error)?;
            tx.commit().map_err(error)?;
        }
        if version < 2 {
            let tx = conn.transaction().map_err(error)?;
            tx.execute_batch(
                "ALTER TABLE bookmarks ADD COLUMN content TEXT NOT NULL DEFAULT '';
                 PRAGMA user_version=2;",
            )
            .map_err(error)?;
            tx.commit().map_err(error)?;
        }
        if version < 3 {
            conn.execute_batch("BEGIN; ALTER TABLE bookmarks ADD COLUMN attachment TEXT; PRAGMA user_version=3; COMMIT;").map_err(error)?;
        }
        Ok(Self(Mutex::new(conn)))
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| "Não foi possível acessar a biblioteca".into())
    }

    pub fn library(&self) -> AppResult<Library> {
        let conn = self.lock()?;
        let mut query = conn.prepare(&format!(
            "SELECT {BOOKMARK_COLUMNS} FROM bookmarks WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC"
        )).map_err(error)?;
        let bookmarks = query
            .query_map([], bookmark_row)
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        let mut query = conn
            .prepare("SELECT id,name,color FROM collections ORDER BY name COLLATE NOCASE")
            .map_err(error)?;
        let collections = query
            .query_map([], |r| {
                Ok(Collection {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                })
            })
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        Ok(Library {
            bookmarks,
            collections,
        })
    }

    pub fn add(&self, input: &str, collection_id: Option<&str>) -> AppResult<Added> {
        let url = normalize_url(input)?;
        let conn = self.lock()?;
        let existing: Option<(String, Option<i64>)> = conn
            .query_row(
                "SELECT id,deleted_at FROM bookmarks WHERE url=?1",
                [url.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        if let Some((id, deleted_at)) = existing {
            if deleted_at.is_some() {
                conn.execute(
                    "UPDATE bookmarks SET deleted_at=NULL,collection_id=COALESCE(?2,collection_id),created_at=?3 WHERE id=?1",
                    params![id, collection_id, Utc::now().timestamp_millis()],
                ).map_err(error)?;
            }
            return Ok(Added {
                id,
                duplicate: deleted_at.is_none(),
            });
        }
        let id = Uuid::new_v4().to_string();
        let domain = url.host_str().unwrap_or("").trim_start_matches("www.");
        conn.execute(
            "INSERT INTO bookmarks(id,url,title,domain,kind,collection_id,created_at) VALUES(?1,?2,?3,?3,?4,?5,?6)",
            params![id, url.as_str(), domain, guess_kind(&url), collection_id, Utc::now().timestamp_millis()],
        ).map_err(error)?;
        Ok(Added {
            id,
            duplicate: false,
        })
    }

    pub fn create_note(
        &self,
        title: &str,
        content: &str,
        collection_id: Option<&str>,
    ) -> AppResult<Added> {
        let title = note_title(title, content)?;
        let id = Uuid::new_v4().to_string();
        self.lock()?.execute(
            "INSERT INTO bookmarks(id,url,title,domain,kind,content,collection_id,created_at,preview_status,title_edited)
             VALUES(?1,?2,?3,'','note',?4,?5,?6,'ready',1)",
            params![id, format!("untab:note/{id}"), title, content, collection_id, Utc::now().timestamp_millis()],
        ).map_err(error)?;
        Ok(Added {
            id,
            duplicate: false,
        })
    }

    pub fn add_file(
        &self,
        file: &crate::files::Attachment,
        collection_id: Option<&str>,
        preview: Option<&str>,
    ) -> AppResult<Added> {
        crate::files::validate_metadata(file)?;
        let url = format!("untab:file/{}", file.sha256);
        let conn = self.lock()?;
        let existing: Option<(String, Option<i64>)> = conn
            .query_row(
                "SELECT id,deleted_at FROM bookmarks WHERE url=?1",
                [&url],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        if let Some((id, deleted)) = existing {
            conn.execute("UPDATE bookmarks SET deleted_at=NULL,collection_id=CASE WHEN deleted_at IS NOT NULL THEN ?2 ELSE collection_id END WHERE id=?1", params![id,collection_id])
                .map_err(error)?;
            return Ok(Added {
                id,
                duplicate: deleted.is_none(),
            });
        }
        let id = Uuid::new_v4().to_string();
        conn.execute("INSERT INTO bookmarks(id,url,title,domain,kind,collection_id,created_at,preview_status,title_edited,attachment,image_path) VALUES(?1,?2,?3,'',?4,?5,?6,'ready',1,?7,?8)", params![id,url,file.name,crate::files::kind(&file.name),collection_id,Utc::now().timestamp_millis(),serde_json::to_string(file).map_err(error)?,preview]).map_err(error)?;
        Ok(Added {
            id,
            duplicate: false,
        })
    }

    pub fn edit_note(
        &self,
        id: &str,
        title: &str,
        content: &str,
        collection_id: Option<&str>,
    ) -> AppResult<()> {
        let title = note_title(title, content)?;
        let changed = self
            .lock()?
            .execute(
                "UPDATE bookmarks SET title=?2,content=?3,collection_id=?4,title_edited=1
             WHERE id=?1 AND kind='note' AND deleted_at IS NULL",
                params![id, title, content, collection_id],
            )
            .map_err(error)?;
        if changed == 0 {
            return Err("Nota não encontrada".into());
        }
        Ok(())
    }

    pub fn get(&self, id: &str) -> AppResult<Bookmark> {
        self.lock()?
            .query_row(
                &format!(
                    "SELECT {BOOKMARK_COLUMNS} FROM bookmarks WHERE id=?1 AND deleted_at IS NULL"
                ),
                [id],
                bookmark_row,
            )
            .map_err(|_| "Bookmark não encontrado".into())
    }

    pub fn edit(&self, id: &str, title: &str, collection_id: Option<&str>) -> AppResult<()> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 500 {
            return Err("Use um título entre 1 e 500 caracteres".into());
        }
        self.lock()?.execute("UPDATE bookmarks SET title=?2,title_edited=1,collection_id=?3 WHERE id=?1 AND deleted_at IS NULL", params![id,title,collection_id])
            .map_err(error)?;
        Ok(())
    }

    pub fn favorite(&self, id: &str, favorite: bool) -> AppResult<()> {
        self.lock()?
            .execute(
                "UPDATE bookmarks SET favorite=?2 WHERE id=?1 AND deleted_at IS NULL",
                params![id, favorite],
            )
            .map_err(error)?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.lock()?
            .execute(
                "UPDATE bookmarks SET deleted_at=?2 WHERE id=?1",
                params![id, Utc::now().timestamp_millis()],
            )
            .map_err(error)?;
        Ok(())
    }

    pub fn restore(&self, id: &str) -> AppResult<()> {
        self.lock()?
            .execute("UPDATE bookmarks SET deleted_at=NULL WHERE id=?1", [id])
            .map_err(error)?;
        Ok(())
    }

    pub fn create_collection(&self, name: &str, color: &str) -> AppResult<String> {
        validate_collection(name, color)?;
        let id = Uuid::new_v4().to_string();
        self.lock()?
            .execute(
                "INSERT INTO collections(id,name,color) VALUES(?1,?2,?3)",
                params![id, name.trim(), color],
            )
            .map_err(|_| "Já existe uma coleção com esse nome".to_string())?;
        Ok(id)
    }

    pub fn edit_collection(&self, id: &str, name: &str, color: &str) -> AppResult<()> {
        validate_collection(name, color)?;
        self.lock()?
            .execute(
                "UPDATE collections SET name=?2,color=?3 WHERE id=?1",
                params![id, name.trim(), color],
            )
            .map_err(|_| "Já existe uma coleção com esse nome".to_string())?;
        Ok(())
    }

    pub fn delete_collection(&self, id: &str) -> AppResult<()> {
        self.lock()?
            .execute("DELETE FROM collections WHERE id=?1", [id])
            .map_err(error)?;
        Ok(())
    }

    pub fn pending(&self) -> AppResult<Vec<String>> {
        let conn = self.lock()?;
        let mut query = conn
            .prepare(
                "SELECT id FROM bookmarks WHERE preview_status='pending' AND deleted_at IS NULL AND kind!='note' AND attachment IS NULL",
            )
            .map_err(error)?;
        let ids = query
            .query_map([], |r| r.get(0))
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        Ok(ids)
    }

    pub fn mark_pending(&self, id: &str) -> AppResult<()> {
        let item = self.get(id)?;
        if item.kind == "note" || item.attachment.is_some() {
            return Err("Este item não precisa de prévia da web".into());
        }
        self.lock()?
            .execute(
                "UPDATE bookmarks SET preview_status='pending' WHERE id=?1 AND deleted_at IS NULL",
                [id],
            )
            .map_err(error)?;
        Ok(())
    }

    pub fn file_preview(&self, id: &str, image: &str) -> AppResult<()> {
        self.lock()?
            .execute(
                "UPDATE bookmarks SET image_path=?2 WHERE id=?1 AND attachment IS NOT NULL",
                params![id, image],
            )
            .map_err(error)?;
        Ok(())
    }

    pub fn apply_metadata(&self, id: &str, metadata: Option<Metadata>) -> AppResult<()> {
        let conn = self.lock()?;
        if let Some(meta) = metadata {
            conn.execute(
                "UPDATE bookmarks SET title=CASE WHEN title_edited=0 THEN COALESCE(?2,title) ELSE title END,
                 description=?3,kind=COALESCE(?4,kind),image_path=COALESCE(?5,image_path),preview_status='ready' WHERE id=?1 AND kind!='note' AND attachment IS NULL",
                params![id,meta.title,meta.description,meta.kind,meta.image_path],
            ).map_err(error)?;
        } else {
            conn.execute(
                "UPDATE bookmarks SET preview_status='unavailable' WHERE id=?1 AND kind!='note' AND attachment IS NULL",
                [id],
            )
            .map_err(error)?;
        }
        Ok(())
    }

    pub fn backup(&self) -> AppResult<Backup> {
        let library = self.library()?;
        Ok(Backup {
            version: 3,
            exported_at: Utc::now().timestamp_millis(),
            collections: library.collections,
            bookmarks: library
                .bookmarks
                .into_iter()
                .map(|b| BackupBookmark {
                    url: b.url,
                    title: b.title,
                    description: b.description,
                    kind: b.kind,
                    collection_id: b.collection_id,
                    favorite: b.favorite,
                    created_at: b.created_at,
                    content: b.content,
                    attachment: b.attachment,
                })
                .collect(),
        })
    }

    pub fn import(&self, backup: Backup) -> AppResult<usize> {
        if ![1, 2, 3].contains(&backup.version)
            || backup.bookmarks.len() > 50_000
            || backup.collections.len() > 5_000
        {
            return Err("Formato de backup não suportado".into());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(error)?;
        let mut collection_map = HashMap::new();
        for c in backup.collections {
            validate_collection(&c.name, &c.color)?;
            let id: Option<String> = tx
                .query_row(
                    "SELECT id FROM collections WHERE name=?1",
                    [c.name.trim()],
                    |r| r.get(0),
                )
                .optional()
                .map_err(error)?;
            let id = match id {
                Some(id) => id,
                None => {
                    let id = Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO collections(id,name,color) VALUES(?1,?2,?3)",
                        params![id, c.name.trim(), c.color],
                    )
                    .map_err(error)?;
                    id
                }
            };
            collection_map.insert(c.id, id);
        }
        let mut count = 0;
        for b in backup.bookmarks {
            let is_note = b.kind == "note";
            let is_file = b.attachment.is_some();
            let (url, domain) = if let Some(file) = &b.attachment {
                crate::files::validate_metadata(file)?;
                if backup.version < 3
                    || b.url != format!("untab:file/{}", file.sha256)
                    || b.kind != crate::files::kind(&file.name)
                {
                    return Err("Arquivo inválido no backup".into());
                }
                (b.url.clone(), String::new())
            } else if is_note {
                if backup.version < 2 {
                    return Err("Formato de nota não suportado".into());
                }
                note_title(&b.title, &b.content)?;
                let id = b
                    .url
                    .strip_prefix("untab:note/")
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or_else(|| "O backup contém uma nota inválida".to_string())?;
                (format!("untab:note/{id}"), String::new())
            } else {
                let url = normalize_url(&b.url)?;
                let domain = url
                    .host_str()
                    .unwrap_or("")
                    .trim_start_matches("www.")
                    .to_owned();
                (url.to_string(), domain)
            };
            if b.title.trim().is_empty()
                || b.title.chars().count() > 500
                || b.description.len() > 20_000
                || ![
                    "site", "article", "video", "image", "document", "note", "audio", "file",
                ]
                .contains(&b.kind.as_str())
                || (!is_note && !b.content.is_empty())
                || b.created_at < 0
                || b.created_at > Utc::now().timestamp_millis() + 86_400_000
            {
                return Err("O backup contém um bookmark inválido".into());
            }
            let collection_id = b
                .collection_id
                .as_ref()
                .and_then(|id| collection_map.get(id));
            count += tx.execute(
                "INSERT INTO bookmarks(id,url,title,description,domain,kind,collection_id,favorite,created_at,title_edited,content,preview_status,attachment)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?11,?12)
                 ON CONFLICT(url) DO UPDATE SET deleted_at=NULL WHERE bookmarks.deleted_at IS NOT NULL",
                params![Uuid::new_v4().to_string(),url,b.title.trim(),b.description,domain,b.kind,collection_id,b.favorite,b.created_at,b.content,if is_note || is_file { "ready" } else { "pending" }, b.attachment.as_ref().map(serde_json::to_string).transpose().map_err(error)?],
            ).map_err(error)?;
        }
        tx.commit().map_err(error)?;
        Ok(count)
    }
}

fn note_title(title: &str, content: &str) -> AppResult<String> {
    if content.trim().is_empty() || content.chars().count() > 100_000 {
        return Err("Escreva uma nota com até 100.000 caracteres".into());
    }
    if title.trim().chars().count() > 500 {
        return Err("Use um título com até 500 caracteres".into());
    }
    Ok(if title.trim().is_empty() {
        content
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Nota")
            .trim()
            .chars()
            .take(80)
            .collect()
    } else {
        title.trim().to_owned()
    })
}

fn validate_collection(name: &str, color: &str) -> AppResult<()> {
    if name.trim().is_empty() || name.trim().chars().count() > 80 {
        return Err("Use um nome entre 1 e 80 caracteres".into());
    }
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Cor inválida".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_two_notes_survive_migration_and_files_restore_into_selected_collection() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("db.sqlite");
        let db = Database::open(&path).unwrap();
        let note = db
            .create_note("Uma nota", "Texto original\ncom acentos", None)
            .unwrap();
        db.favorite(&note.id, true).unwrap();
        drop(db);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("ALTER TABLE bookmarks DROP COLUMN attachment; PRAGMA user_version=2;")
            .unwrap();
        drop(conn);
        let db = Database::open(&path).unwrap();
        let migrated = db.get(&note.id).unwrap();
        assert_eq!(migrated.content, "Texto original\ncom acentos");
        assert!(migrated.favorite && migrated.attachment.is_none());
        let file = crate::files::store_reader(&root.path().join("files"), "text.txt", &b"text"[..])
            .unwrap();
        let added = db.add_file(&file, None, None).unwrap();
        db.delete(&added.id).unwrap();
        let collection = db.create_collection("Arquivos", "#112233").unwrap();
        let restored = db.add_file(&file, Some(&collection), None).unwrap();
        assert!(!restored.duplicate);
        assert_eq!(restored.id, added.id);
        assert_eq!(db.get(&added.id).unwrap().collection_id, Some(collection));
        assert!(db.pending().unwrap().is_empty());
    }

    #[test]
    fn persists_and_deduplicates_without_discarding_query_or_fragment() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.db");
        let db = Database::open(&path).unwrap();
        let a = db
            .add(" https://EXAMPLE.com/page?one=2#section ", None)
            .unwrap();
        assert!(
            db.add("https://example.com/page?one=2#section", None)
                .unwrap()
                .duplicate
        );
        assert!(
            !db.add("https://example.com/page?one=3#section", None)
                .unwrap()
                .duplicate
        );
        drop(db);
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.get(&a.id).unwrap().url,
            "https://example.com/page?one=2#section"
        );
        assert_eq!(db.library().unwrap().bookmarks.len(), 2);
    }

    #[test]
    fn edits_survive_late_metadata_and_deleting_collections_keeps_links() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("library.db")).unwrap();
        let c = db.create_collection("Design", "#a999cd").unwrap();
        let b = db.add("https://example.com", Some(&c)).unwrap();
        db.edit(&b.id, "Meu título", Some(&c)).unwrap();
        db.apply_metadata(
            &b.id,
            Some(Metadata {
                title: Some("Título remoto".into()),
                ..Default::default()
            }),
        )
        .unwrap();
        db.delete_collection(&c).unwrap();
        assert_eq!(db.get(&b.id).unwrap().title, "Meu título");
        assert!(db.get(&b.id).unwrap().collection_id.is_none());
        db.delete(&b.id).unwrap();
        assert!(db.library().unwrap().bookmarks.is_empty());
        db.restore(&b.id).unwrap();
        assert_eq!(db.library().unwrap().bookmarks.len(), 1);
    }

    #[test]
    fn backup_restores_collections_and_invalid_import_rolls_back() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("a.db")).unwrap();
        let c = db.create_collection("Design", "#a999cd").unwrap();
        let b = db.add("https://example.com", Some(&c)).unwrap();
        db.favorite(&b.id, true).unwrap();
        let other = Database::open(&dir.path().join("b.db")).unwrap();
        assert_eq!(other.import(db.backup().unwrap()).unwrap(), 1);
        assert_eq!(other.import(db.backup().unwrap()).unwrap(), 0);
        assert!(other.library().unwrap().bookmarks[0].favorite);
        assert_eq!(other.library().unwrap().collections.len(), 1);
        let mut backup = db.backup().unwrap();
        backup.collections[0].name = "Outra coleção".into();
        backup.bookmarks[0].url = "javascript:alert(1)".into();
        assert!(other.import(backup).is_err());
        assert_eq!(other.library().unwrap().collections.len(), 1);
    }

    #[test]
    fn pasting_a_deleted_link_restores_it_into_the_selected_collection() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("library.db")).unwrap();
        let original = db.create_collection("Original", "#a999cd").unwrap();
        let selected = db.create_collection("Selecionada", "#c4a788").unwrap();
        let bookmark = db.add("https://example.com", Some(&original)).unwrap();
        db.edit(&bookmark.id, "Título preservado", Some(&original))
            .unwrap();
        db.delete(&bookmark.id).unwrap();
        let restored = db.add("https://example.com", Some(&selected)).unwrap();
        assert_eq!(restored.id, bookmark.id);
        assert!(!restored.duplicate);
        let bookmark = db.get(&restored.id).unwrap();
        assert_eq!(bookmark.collection_id.as_deref(), Some(selected.as_str()));
        assert_eq!(bookmark.title, "Título preservado");
        assert_eq!(db.library().unwrap().bookmarks.len(), 1);
    }

    #[test]
    fn accepts_web_links_and_rejects_non_links() {
        assert_eq!(
            normalize_url("example.com/a").unwrap().as_str(),
            "https://example.com/a"
        );
        for input in [
            "",
            "texto solto",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://example.com\nhttps://other.com",
        ] {
            assert!(normalize_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn notes_preserve_text_and_support_edit_favorite_undo_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.db");
        let db = Database::open(&path).unwrap();
        let collection = db.create_collection("Ideias", "#a999cd").unwrap();
        let content = "  Primeira linha\n\n  Texto com acentos e espaços  \n";
        let note = db.create_note("", content, Some(&collection)).unwrap();
        assert_eq!(db.get(&note.id).unwrap().title, "Primeira linha");
        assert_eq!(db.get(&note.id).unwrap().content, content);
        assert!(db.pending().unwrap().is_empty());
        assert!(db.mark_pending(&note.id).is_err());
        db.apply_metadata(
            &note.id,
            Some(Metadata {
                title: Some("Remoto".into()),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(db.get(&note.id).unwrap().title, "Primeira linha");
        assert!(db.edit_note(&note.id, "Inválida", " \n", None).is_err());
        db.edit_note(&note.id, "Minha nota", content, Some(&collection))
            .unwrap();
        db.favorite(&note.id, true).unwrap();
        db.delete(&note.id).unwrap();
        assert!(db.library().unwrap().bookmarks.is_empty());
        db.restore(&note.id).unwrap();
        drop(db);
        let db = Database::open(&path).unwrap();
        let saved = db.get(&note.id).unwrap();
        assert_eq!(saved.content, content);
        assert!(saved.favorite);
        assert_eq!(saved.collection_id.as_deref(), Some(collection.as_str()));
        let other = Database::open(&dir.path().join("restored.db")).unwrap();
        let serialized = serde_json::to_vec(&db.backup().unwrap()).unwrap();
        assert_eq!(
            other
                .import(serde_json::from_slice(&serialized).unwrap())
                .unwrap(),
            1
        );
        assert_eq!(other.import(db.backup().unwrap()).unwrap(), 0);
        let restored = other.library().unwrap().bookmarks.remove(0);
        assert_eq!(restored.content, content);
        assert_eq!(restored.kind, "note");
        assert!(other.pending().unwrap().is_empty());
        let mut invalid = db.backup().unwrap();
        invalid.bookmarks[0].url = "https://example.com".into();
        assert!(other.import(invalid).is_err());
    }

    #[test]
    fn version_one_database_and_backups_keep_existing_links() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.db");
        let db = Database::open(&path).unwrap();
        let link = db.add("https://example.com/?keep=1#section", None).unwrap();
        db.edit(&link.id, "Título original", None).unwrap();
        db.favorite(&link.id, true).unwrap();
        db.apply_metadata(
            &link.id,
            Some(Metadata {
                image_path: Some("original.webp".into()),
                ..Default::default()
            }),
        )
        .unwrap();
        let original = db.get(&link.id).unwrap();
        let mut legacy = serde_json::to_value(db.backup().unwrap()).unwrap();
        legacy["version"] = 1.into();
        legacy["bookmarks"][0]
            .as_object_mut()
            .unwrap()
            .remove("content");
        drop(db);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("ALTER TABLE bookmarks DROP COLUMN content; ALTER TABLE bookmarks DROP COLUMN attachment; PRAGMA user_version=1;")
            .unwrap();
        drop(connection);
        let db = Database::open(&path).unwrap();
        let migrated = db.get(&link.id).unwrap();
        assert_eq!(migrated.url, original.url);
        assert_eq!(migrated.title, original.title);
        assert_eq!(migrated.image_path, original.image_path);
        assert_eq!(migrated.created_at, original.created_at);
        assert!(migrated.favorite);
        assert!(migrated.content.is_empty());
        assert_eq!(
            db.lock()
                .unwrap()
                .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            3
        );
        let other = Database::open(&dir.path().join("legacy-backup.db")).unwrap();
        assert_eq!(
            other
                .import(serde_json::from_value(legacy).unwrap())
                .unwrap(),
            1
        );
        assert_eq!(other.library().unwrap().bookmarks[0].url, original.url);
    }
}
