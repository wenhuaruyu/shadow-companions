import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));

test("Figma页面的本地素材、原型跳转和CG先行目标完整", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(publicRoot, "figma/manifest.json"), "utf8"),
  );
  const known = new Set(
    [...manifest.scenes, ...manifest.cg, ...manifest.aliases].map(
      (scene) => scene.id,
    ),
  );
  const assets = new Set();
  for (const scene of manifest.scenes) {
    const html = await readFile(resolve(publicRoot, "." + scene.file), "utf8");
    assert.ok(html.includes(`data-node-id="${scene.id}"`), scene.id);
    assert.ok(!html.includes("https://www.figma.com/api/mcp/asset/"), scene.id);
    for (const match of html.matchAll(/src="(\/assets\/[^"?#]+)"/g))
      assets.add(match[1]);
    for (const link of scene.links)
      assert.ok(
        known.has(link.destination),
        `${scene.id} → ${link.destination}`,
      );
  }
  for (const scene of manifest.cg)
    assert.ok(known.has(scene.destination), scene.id);
  const direct = new Set(manifest.scenes.map((scene) => scene.id));
  const routes = new Map(
    [...manifest.cg, ...manifest.aliases].map((scene) => [
      scene.id,
      scene.destination,
    ]),
  );
  for (const start of routes.keys()) {
    const visited = new Set();
    let target = start;
    while (!direct.has(target) && !visited.has(target)) {
      visited.add(target);
      target = routes.get(target);
    }
    assert.ok(direct.has(target), `原型跳转不得循环或中断 ${start}`);
  }
  for (const asset of assets) {
    const path = resolve(publicRoot, "." + asset);
    assert.ok((await stat(path)).size > 0, asset);
    if (asset.endsWith(".png")) {
      const header = (await readFile(path)).subarray(0, 24);
      assert.ok(header.readUInt32BE(16) > 32, `${asset} 不应是32像素占位图`);
    }
  }
});
