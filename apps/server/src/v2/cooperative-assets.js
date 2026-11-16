import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const web = fileURLToPath(new URL('../../../web/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };

export async function serveCooperativeAsset(request, response, pathname) {
  if (pathname.startsWith('/api/')) return false;
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { response.writeHead(400).end(); return true; }
  const preview = new URL(request.url, 'http://localhost').searchParams.get('preview') === '1';
  const relative = decoded === '/' ? preview ? 'index.html' : 'online.html' : decoded.slice(1);
  const built = resolve(web, 'dist');
  let root = built;
  try { await stat(resolve(built, 'online.html')); }
  catch { root = relative === 'index.html' || relative.startsWith('src/') ? web : resolve(web, 'public'); }
  let path = resolve(root, relative);
  if (!path.startsWith(root + sep) || !types[extname(path)]) {
    response.writeHead(404).end(); return true;
  }
  try {
    let info;
    try { info = await stat(path); }
    catch (error) {
      if (error.code !== 'ENOENT' || !relative.startsWith('assets/figma/') || extname(path) !== '.png') throw error;
      // Older open tabs can still request their original PNG URLs after release.
      const map = JSON.parse(await readFile(resolve(root, 'asset-map.json'), 'utf8'));
      const replacement = map['/' + relative];
      if (!/^\/assets\/figma\/[a-f0-9]{16}\.webp$/.test(replacement || '')) throw error;
      path = resolve(root, '.' + replacement);
      info = await stat(path);
    }
    if (!info.isFile()) { response.writeHead(404).end(); return true; }
    const headers = {
      'Content-Type': types[extname(path)], 'Content-Disposition': 'inline',
      'Cache-Control': /[a-f0-9]{16}\.webp$/.test(path) ? 'public, max-age=31536000, immutable' : relative.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Vary': 'Accept-Encoding',
    };
    let delivered = path;
    const encodings = (request.headers['accept-encoding'] || '').split(',').map(item => item.trim());
    if (/\.(html|js|css|json|svg)$/.test(path)) {
      const encoding = encodings.includes('br') ? 'br' : encodings.includes('gzip') ? 'gzip' : null;
      if (encoding) {
        try {
          info = await stat(path + (encoding === 'br' ? '.br' : '.gz'));
          delivered += encoding === 'br' ? '.br' : '.gz';
          headers['Content-Encoding'] = encoding;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    headers.ETag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}-${headers['Content-Encoding'] || 'identity'}"`;
    if ((request.headers['if-none-match'] || '').split(/,\s*/).includes(headers.ETag)) {
      response.writeHead(304, headers).end(); return true;
    }
    headers['Content-Length'] = info.size;
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : await readFile(delivered));
  } catch (error) {
    if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error;
    response.writeHead(404).end();
  }
  return true;
}
