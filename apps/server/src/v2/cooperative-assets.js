import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const web = new URL('../../../web/', import.meta.url);
const assets = new Map([
  ['/games/cooperative.html', ['public/games/cooperative.html', 'text/html; charset=utf-8']],
  ['/src/games/cooperative.js', ['src/games/cooperative.js', 'text/javascript; charset=utf-8']],
  ['/src/games/cooperative.css', ['src/games/cooperative.css', 'text/css; charset=utf-8']],
  ['/src/state/storage.js', ['src/state/storage.js', 'text/javascript; charset=utf-8']],
  ['/src/components/dom.js', ['src/components/dom.js', 'text/javascript; charset=utf-8']],
]);

// Serve only the cooperative page and its explicit dependencies.
export async function serveCooperativeAsset(request, response, pathname) {
  const asset = assets.get(pathname);
  if (!asset) return false;
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return true;
  }
  const [path, contentType] = asset;
  const body = await readFile(fileURLToPath(new URL(path, web)));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  return true;
}
