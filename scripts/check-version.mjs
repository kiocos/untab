import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const version = JSON.parse(readFileSync("package.json")).version;
assert.equal(process.argv[2], `v${version}`, "Tag must match the app version");
for (const file of ["package-lock.json", "src-tauri/tauri.conf.json"]) {
  assert.equal(JSON.parse(readFileSync(file)).version, version, `${file} version`);
}
assert.match(readFileSync("src-tauri/Cargo.toml", "utf8"), new RegExp(`^version = "${version.replaceAll(".", "\\.")}"$`, "m"));
assert.match(readFileSync("src-tauri/Cargo.lock", "utf8"), new RegExp(`name = "untab"\nversion = "${version.replaceAll(".", "\\.")}"`));
console.log(`All package versions match ${version}`);
