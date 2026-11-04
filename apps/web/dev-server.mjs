import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(process.env.WEB_PORT || 5173);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(`${root}${sep}`) || (!path.endsWith('index.html') && !path.startsWith(`${root}${sep}src${sep}`))) {
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Web skeleton: http://localhost:${port}`));
