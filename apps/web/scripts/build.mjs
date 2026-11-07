import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "src"), resolve(output, "src"), { recursive: true });
await cp(resolve(root, "public"), output, { recursive: true });
await cp(resolve(root, "index.html"), resolve(output, "index.html"));
const html = await readFile(resolve(output, "index.html"), "utf8");
for (const reference of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  await readFile(resolve(output, "." + reference[1]));
}
console.log("前端静态产物已生成：apps/web/dist");
