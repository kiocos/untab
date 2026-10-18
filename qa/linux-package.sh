#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true || { echo 'Use an isolated CI runner'; exit 1; }
test_root=$(mktemp -d)
test_pid=''
cleanup() {
  if test -n "$test_pid"; then kill "$test_pid" 2>/dev/null || true; fi
  rm -rf "$test_root"
}
trap cleanup EXIT
export XDG_DATA_HOME="$test_root/data" XDG_CACHE_HOME="$test_root/cache" XDG_CONFIG_HOME="$test_root/config"
packages=(release-artifacts/*.AppImage)
test "${#packages[@]}" = 1
package=${packages[0]}
chmod +x "$package"
"$package" --appimage-extract-and-run > "$test_root/app.log" 2>&1 &
test_pid=$!
database="$XDG_DATA_HOME/local.untab.app/untab.sqlite3"
for attempt in {1..90}; do
  if test -f "$database"; then break; fi
  if ! kill -0 "$test_pid" 2>/dev/null; then cat "$test_root/app.log"; exit 1; fi
  sleep 0.5
done
test -f "$database" || { cat "$test_root/app.log"; exit 1; }
python3 - "$database" <<'PY'
import sqlite3
import sys
connection = sqlite3.connect(sys.argv[1])
assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
print("Packaged Linux AppImage opened its library successfully")
PY
