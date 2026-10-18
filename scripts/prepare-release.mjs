import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const dir = process.argv[2];
if (!dir) throw new Error("Usage: node scripts/prepare-release.mjs <artifact-directory>");
const { version } = JSON.parse(readFileSync("package.json"));
const names = readdirSync(dir);
function one(pattern) {
  const found = names.filter(name => pattern.test(name));
  assert.equal(found.length, 1, `Expected one ${pattern}, got ${found.length}`);
  return found[0];
}
const windows = one(/-setup\.exe$/);
const linux = one(/\.AppImage$/);
const mac = one(/\.app\.tar\.gz$/);
for (const name of [windows, linux, one(/\.dmg$/), one(/\.deb$/)]) {
  assert(name.includes(version), `Wrong version: ${name}`);
}
function entry(name) {
  const signature = readFileSync(join(dir, `${name}.sig`), "utf8").trim();
  assert(signature.length > 80, `Missing signature: ${name}`);
  return { url: `https://github.com/kiocos/untab/releases/download/v${version}/${encodeURIComponent(name)}`, signature };
}
const notes = readFileSync("CHANGELOG.md", "utf8").split(/^## /m)[1]?.replace(/^.*\n/, "").trim();
const manifest = {
  version, notes, pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": entry(windows),
    "linux-x86_64": entry(linux),
    "darwin-aarch64": entry(mac),
    "darwin-x86_64": entry(mac),
  },
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
const sums = readdirSync(dir).filter(name => !name.startsWith("SHA256SUMS")).sort().map(name => {
  const hash = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
  return `${hash}  ${name}`;
}).join("\n") + "\n";
writeFileSync(join(dir, "SHA256SUMS.txt"), sums);
console.log(`Prepared ${version} for four platform targets`);
