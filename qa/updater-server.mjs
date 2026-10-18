import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const installer = readFileSync(join(root, "update.exe"));
const tampered = Buffer.from(installer);
tampered[tampered.length - 1] ^= 1;
const signature = readFileSync(join(root, "update.exe.sig"), "utf8").trim();
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
let origin;
const server = createServer((request, response) => {
  if (request.url === "/update.exe" || request.url === "/tampered.exe") {
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": installer.length });
    response.end(request.url === "/update.exe" ? installer : tampered);
  } else if (["/latest.json", "/tampered.json", "/wrong-version.json"].includes(request.url)) {
    const manifestVersion = request.url === "/wrong-version.json" ? "99.0.0" : version;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      version: manifestVersion,
      platforms: { "windows-x86_64": {
        url: `${origin}/${request.url === "/tampered.json" ? "tampered" : "update"}.exe`, signature,
      } },
    }));
  } else {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1", () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(root, "endpoint.txt"), origin);
});
