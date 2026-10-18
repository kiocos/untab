import { mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const root = process.platform === "darwin"
  ? "src-tauri/target/universal-apple-darwin/release/bundle"
  : "src-tauri/target/release/bundle";
if (!existsSync(root)) throw new Error(`Missing bundle directory: ${root}`);
mkdirSync("release-artifacts", { recursive: true });
let count = 0;
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith(".app")) collect(path);
    if (entry.isFile() && /\.(dmg|exe|deb|AppImage|tar\.gz)(\.sig)?$/.test(entry.name)) {
      copyFileSync(path, join("release-artifacts", entry.name));
      count++;
    }
  }
}
collect(root);
if (count < 2) throw new Error("Missing installer or update signature");
console.log(`Collected ${count} release files`);
