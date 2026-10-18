import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--manifest-path", "src-tauri/Cargo.toml"], { maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }));
const entries = metadata.packages.filter(p => p.name !== "untab").map(p => ({
  name: `${p.name} ${p.version}`, license: p.license, url: p.repository,
  directory: dirname(p.manifest_path), extra: p.license_file,
}));
const seen = new Set();
function npmPackage(name, from) {
  let directory = from;
  while (!existsSync(join(directory, "node_modules", name, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Missing dependency ${name}`);
    directory = parent;
  }
  directory = join(directory, "node_modules", name);
  if (seen.has(directory)) return;
  seen.add(directory);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json")));
  entries.push({ name: `${pkg.name} ${pkg.version}`, license: pkg.license, url: pkg.homepage, directory });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) npmPackage(dependency, directory);
}
for (const name of Object.keys(JSON.parse(readFileSync("package.json")).dependencies)) npmPackage(name, resolve("."));
const texts = new Map();
const notices = entries.sort((a, b) => a.name.localeCompare(b.name)).map(pkg => {
  const paths = readdirSync(pkg.directory, { withFileTypes: true }).filter(entry => entry.isFile() && /^(license|copying|notice|unlicense)([.\-_]|$)/i.test(entry.name)).map(entry => join(pkg.directory, entry.name));
  if (pkg.extra && existsSync(join(pkg.directory, pkg.extra))) paths.push(join(pkg.directory, pkg.extra));
  const ids = [...new Set(paths)].map(path => {
    const content = readFileSync(path, "utf8").split(/\r?\n/).map(line => line.trimEnd()).join("\n").trim();
    if (!texts.has(content)) texts.set(content, texts.size + 1);
    return texts.get(content);
  });
  return `\n${pkg.name}\nLicense: ${pkg.license ?? "See source"}\n${pkg.url ?? ""}\nLicense texts: ${ids.join(", ") || "See upstream source package"}\n`;
}).join("\n");
writeFileSync("THIRD_PARTY_LICENSES.txt", "Third-party source package license notices\nGenerated from Cargo.lock and installed production npm packages\n" + notices + [...texts].map(([body, id]) => `\n${"=".repeat(72)}\nLicense text ${id}\n\n${body}\n`).join("\n"));
console.log(`Collected license notices for ${entries.length} source packages`);
