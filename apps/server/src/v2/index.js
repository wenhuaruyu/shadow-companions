import pg from 'pg';
import { createRoomServer } from './server.js';
import { RpcRoomService } from './rpc.js';

const mode = process.env.STORAGE_MODE || 'pg';
if (!['pg', 'rpc'].includes(mode)) throw new Error('STORAGE_MODE须为pg或rpc');
let pool;
let server;
if (mode === 'rpc') {
  const service = new RpcRoomService(process.env.RPC_ENDPOINT, process.env.RPC_SERVICE_TOKEN, process.env.PUBLIC_ORIGIN);
  server = createRoomServer(null, process.env.PUBLIC_ORIGIN, service);
} else {
  for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'PUBLIC_ORIGIN']) {
    if (!process.env[name]) throw new Error(`缺少配置 ${name}`);
  }
  pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 5,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true, ...(process.env.DB_CA ? { ca: process.env.DB_CA } : {}) } : undefined
  });
  await pool.query('SELECT 1');
  server = createRoomServer(pool, process.env.PUBLIC_ORIGIN);
}
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => { await pool?.end(); });
  });
}
