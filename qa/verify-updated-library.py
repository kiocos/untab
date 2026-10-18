import hashlib
import json
import sqlite3
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert "error" not in report, report
assert report["stage"] == "installing" and report["from"] == "0.3.9"
assert all(report[key] for key in ("tamperedRejected", "wrongVersionRejected", "failedBackupRejected", "backupRestored"))
data = Path(sys.argv[2])
connection = sqlite3.connect(data / "untab.sqlite3")
connection.row_factory = sqlite3.Row
assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
actual = {row["id"]: dict(row) for row in connection.execute("SELECT * FROM bookmarks WHERE deleted_at IS NULL")}
expected = report["expected"]
assert len(actual) == len(expected["bookmarks"])
for item in expected["bookmarks"]:
    row = actual[item["id"]]
    for field in ("url", "title", "content", "favorite"):
        assert row[field] == item[field], (item["id"], field)
    assert row["collection_id"] == item["collectionId"]
    if item["attachment"]:
        file = item["attachment"]
        assert json.loads(row["attachment"]) == file
        assert hashlib.sha256((data / "files" / file["path"]).read_bytes()).hexdigest() == file["sha256"]
assert [dict(row) for row in connection.execute("SELECT id,name,color FROM collections ORDER BY name")] == expected["collections"]
assert Path(report["backup"]).is_file()
print(f"Actual updater {report['from']} -> {report['to']}: all {len(actual)} items, collections, favorites and file hashes preserved; recovery archive restored; tampering and version substitution rejected")
