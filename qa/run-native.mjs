import { mkdtempSync, mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

mkdirSync(".qa", { recursive: true });
const directory = mkdtempSync(resolve(".qa", "native-"));
const environment = {
  ...process.env,
  UNTAB_SMOKE_DIR: directory,
  TAURI_CONFIG: JSON.stringify({
    identifier: "local.untab.smoke",
    productName: "Untab QA",
  }),
};
let server;
try {
  if (!(await fetch("http://localhost:1420").catch(() => null))?.ok) {
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--strictPort"], { stdio: "inherit" });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(done => setTimeout(done, 500));
      if ((await fetch("http://localhost:1420").catch(() => null))?.ok) { ready = true; break; }
    }
    if (!ready) throw new Error("Vite did not become ready");
  }
const first = spawnSync(
  "cargo",
  [
    "run",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--features",
    "smoke-test",
  ],
  { env: environment, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
);
function verify(result, phase) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(`Native smoke exited with ${result.status}`);
  const line = result.stdout
    ?.split("\n")
    .find((value) => value.startsWith("UNTAB_SMOKE_RESULT="));
  const report = line && JSON.parse(line.slice("UNTAB_SMOKE_RESULT=".length));
  if (!report?.success || report.phase !== phase) {
    throw new Error(`Native smoke did not confirm ${phase}`);
  }
}
verify(first, "first-run");
await new Promise((done) => setTimeout(done, 2000));
const restart = spawnSync(resolve(`src-tauri/target/debug/untab${process.platform === "win32" ? ".exe" : ""}`), [], {
  env: environment,
  stdio: ["ignore", "pipe", "inherit"],
  encoding: "utf8",
});
verify(restart, "restart");

} finally { server?.kill(); }
