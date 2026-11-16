import { cp, mkdir, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative, extname } from "node:path";
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import sharp from 'sharp';

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "src"), resolve(output, "src"), { recursive: true });
await cp(resolve(root, "public"), output, { recursive: true });
await cp(resolve(root, "index.html"), resolve(output, "index.html"));
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    result.push(...entry.isDirectory() ? await files(path) : [path]);
  }
  return result;
}
// Keep editable PNG originals in public/. Ship smaller, content-addressed
// WebP copies so an art update always gets a new browser cache key.
const images = (await files(resolve(output, 'assets/figma'))).filter(path => path.endsWith('.png'));
const assetMap = {};
let before = 0, after = 0;
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < images.length) {
    const path = images[cursor++];
    const original = await readFile(path);
    const encoded = await sharp(original).webp({ quality: 86, alphaQuality: 100, effort: 4 }).toBuffer();
    const hash = createHash('sha256').update(encoded).digest('hex').slice(0, 16);
    const url = `/assets/figma/${hash}.webp`;
    await writeFile(resolve(output, '.' + url), encoded);
    assetMap['/' + relative(output, path)] = url;
    before += original.length; after += encoded.length;
    await rm(path);
  }
}));
const landscape = '<link rel="stylesheet" href="/src/platform/landscape.css"><script type="module" src="/src/platform/landscape.js"></script>';
for (const path of await files(output)) {
  if (!['.html', '.js', '.css', '.json', '.svg'].includes(extname(path))) continue;
  let content = await readFile(path, 'utf8');
  content = content.replace(/\/assets\/figma\/[\w.-]+\.png/g, url => assetMap[url] || url);
  // Future standalone games inherit the same orientation requirement.
  if (relative(output, path).startsWith('games/') && path.endsWith('.html') && !content.includes('/src/platform/landscape.js')) {
    content = content.includes('</head>') ? content.replace('</head>', landscape + '</head>') : content.replace('<style>', landscape + '<style>');
  }
  if (['index.html', 'online.html'].includes(relative(output, path))) {
    content = content.replace('</head>', `<link rel="preload" as="image" href="${assetMap['/assets/figma/e4504.png']}" fetchpriority="high"></head>`);
  }
  await writeFile(path, content);
  // Compression is prepared once at build time, not on each room request.
  if (Buffer.byteLength(content) > 1024) {
    await writeFile(path + '.br', brotliCompressSync(content));
    await writeFile(path + '.gz', gzipSync(content));
  }
}
await writeFile(resolve(output, 'asset-map.json'), JSON.stringify(assetMap));
const html = await readFile(resolve(output, "index.html"), "utf8");
for (const reference of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  await readFile(resolve(output, "." + reference[1]));
}
console.log("前端静态产物已生成：apps/web/dist");
console.log(`剧情图片 ${images.length} 张：${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} MiB，减少 ${(100 - after / before * 100).toFixed(1)}%`);
