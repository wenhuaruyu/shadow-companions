import { createServer } from 'node:http';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end(JSON.stringify({ status: 'ok', service: 'anxian-server', stage: 'project-setup' }));
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: { code: 'NOT_FOUND', message: '该接口尚未实现' } }));
}).listen(port, host, () => console.log(`Server skeleton: http://${host}:${port}`));
