import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RoomService, validateEntry, CONTENT_VERSION } from '../src/v2/rooms.js';
import { createRoomServer } from '../src/v2/server.js';

const entry = () => ({ requestId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), contentVersion: CONTENT_VERSION });

test('v2输入拒绝短凭证和不支持的内容版本', () => {
  validateEntry(entry(), false);
  assert.throws(() => validateEntry({ ...entry(), recoverySecret: 'short' }, false), { code: 'INVALID_INPUT' });
  assert.throws(() => validateEntry({ ...entry(), contentVersion: 'future' }, false), { code: 'CONTENT_VERSION_UNSUPPORTED' });
});

test('v2 HTTP边界拒绝旧协议和非法JSON，不暴露数据库异常', async () => {
  const pool = { connect: async () => { throw new Error('private-password'); } };
  const server = createRoomServer(pool, 'https://game.example.com');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(url + '/api/create', { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'CONTRACT_VERSION_MISMATCH');
    response = await fetch(url + '/api/create', { method: 'POST', headers: { 'X-Contract-Version': '2' }, body: '{' });
    assert.equal((await response.json()).code, 'INVALID_INPUT');
    response = await fetch(url + '/api/create', { method: 'POST', headers: { 'X-Contract-Version': '2' }, body: JSON.stringify(entry()) });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('private-password'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('真实PostgreSQL验证并发抢座、创建重放、本人权限和持久恢复', { skip: !process.env.PG_TEST_URL }, async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL, max: 5 });
  const service = new RoomService(pool, 'https://game.example.com');
  const createdRooms = new Set();
  let roomId;
  try {
    const body = entry();
    const created = await Promise.all([service.enter(body), service.enter(body)]);
    roomId = created[0].id;
    createdRooms.add(roomId);
    assert.equal(created[1].id, roomId);
    const joinBodies = [{ ...entry(), room: roomId }, { ...entry(), room: roomId }];
    const joins = await Promise.allSettled(joinBodies.map(body => service.enter(body, true)));
    assert.equal(joins.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(joins.find(result => result.status === 'rejected').reason.code, 'ROOM_FULL');
    const winner = joins.findIndex(result => result.status === 'fulfilled');
    const replay = await service.enter(joinBodies[winner], true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.seat, 1);
    assert.equal(replay.snapshot.players.length, 2);
    const expiredBody = entry();
    const expiring = await service.enter(expiredBody);
    createdRooms.add(expiring.id);
    await pool.query('UPDATE anxian.game_rooms SET created_at=$1 WHERE id=$2', [Date.now() - 900001, expiring.id]);
    await assert.rejects(service.enter({ ...entry(), room: expiring.id }, true), { code: 'INVITE_EXPIRED' });
    const { rows: expiredPlayers } = await pool.query('SELECT seat FROM anxian.game_players WHERE room_id=$1', [expiring.id]);
    assert.equal(expiredPlayers.length, 1);
    const faultPool = {
      async connect() {
        const connection = await pool.connect();
        return {
          release: () => connection.release(),
          query(sql, parameters) {
            if (sql.startsWith('INSERT INTO anxian.game_rooms')) createdRooms.add(parameters[0]);
            if (sql.startsWith('INSERT INTO anxian.game_requests')) throw new Error('injected failure before commit');
            return connection.query(sql, parameters);
          }
        };
      }
    };
    await assert.rejects(new RoomService(faultPool, 'https://game.example.com').enter(entry()), /injected failure/);
    const rollbackId = [...createdRooms].at(-1);
    const { rows: rolledBack } = await pool.query('SELECT id FROM anxian.game_rooms WHERE id=$1', [rollbackId]);
    assert.equal(rolledBack.length, 0);
    const recovered = await new RoomService(pool, 'https://game.example.com').state(roomId, body.recoverySecret);
    assert.equal(recovered.players.length, 2);
    assert.ok(!JSON.stringify(recovered).includes(body.recoverySecret));
    await assert.rejects(service.state(roomId, entry().recoverySecret), { code: 'INVALID_CREDENTIAL' });
  } finally {
    for (const cleanupRoom of createdRooms) {
      await pool.query('DELETE FROM anxian.game_requests WHERE room_id=$1', [cleanupRoom]);
      await pool.query('DELETE FROM anxian.game_players WHERE room_id=$1', [cleanupRoom]);
      await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [cleanupRoom]);
    }
    await pool.end();
  }
});

test('真实PostgreSQL下HTTP创建、加入重放及后端进程重启恢复', { skip: !process.env.PG_TEST_URL }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { createServer } = await import('node:net');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL, max: 5 });
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const db = new URL(process.env.PG_TEST_URL);
  let child;
  let roomId;
  async function start() {
    child = spawn(process.execPath, [fileURLToPath(new URL('../src/v2/index.js', import.meta.url))], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: base,
        DB_HOST: db.hostname, DB_PORT: db.port || '5432', DB_USER: decodeURIComponent(db.username),
        DB_PASSWORD: decodeURIComponent(db.password), DB_NAME: db.pathname.slice(1),
        DB_SSL: process.env.PG_TEST_SSL || 'false' },
      stdio: 'ignore'
    });
    let spawnError;
    child.once('error', error => { spawnError = error; });
    for (let retry = 0; retry < 100; retry++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('测试后端启动失败');
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await delay(50);
    }
    throw new Error('测试后端启动超时');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  const headers = { 'Content-Type': 'application/json', 'X-Contract-Version': '2' };
  async function post(path, body) {
    const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try {
    await start();
    const body = entry();
    const created = await post('/api/create', body);
    assert.equal(created.status, 201);
    roomId = created.body.id;
    const joinBody = { ...entry(), room: roomId };
    const joins = await Promise.all([post('/api/join', joinBody), post('/api/join', joinBody)]);
    assert.deepEqual(joins.map(result => result.status).sort(), [200, 201]);
    assert.equal(joins[0].body.seat, joins[1].body.seat);
    await stop();
    await start();
    const replay = await post('/api/create', body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, roomId);
    const state = await fetch(`${base}/api/state?room=${roomId}`, {
      headers: { ...headers, Authorization: `Bearer ${body.recoverySecret}` }
    });
    const snapshot = (await state.json()).snapshot;
    assert.equal(snapshot.players.length, 2);
    const unchanged = await fetch(`${base}/api/state?room=${roomId}&knownVersion=${snapshot.version}`, {
      headers: { ...headers, Authorization: `Bearer ${body.recoverySecret}` }
    });
    assert.equal((await unchanged.json()).changed, false);
  } finally {
    await stop();
    if (roomId) {
      await pool.query('DELETE FROM anxian.game_requests WHERE room_id=$1', [roomId]);
      await pool.query('DELETE FROM anxian.game_players WHERE room_id=$1', [roomId]);
      await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [roomId]);
    }
    await pool.end();
  }
});

test('20房间40客户端经HTTP读取真实PostgreSQL状态', { skip: !process.env.PG_TEST_URL }, async t => {
  const { default: pg } = await import('pg');
  const { setTimeout: delay } = await import('node:timers/promises');
  const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL, max: 5 });
  const service = new RoomService(pool, 'https://game.example.com');
  const clients = [];
  const roomIds = [];
  const server = createRoomServer(pool, 'https://game.example.com');
  try {
    for (let index = 0; index < 20; index++) {
      const host = entry();
      const created = await service.enter(host);
      roomIds.push(created.id);
      const guest = { ...entry(), room: created.id };
      await service.enter(guest, true);
      clients.push({ room: created.id, token: host.recoverySecret }, { room: created.id, token: guest.recoverySecret });
    }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const latencies = [];
    for (let round = 0; round < 10; round++) {
      const started = performance.now();
      await Promise.all(clients.map(async client => {
        const before = performance.now();
        const response = await fetch(`${base}/api/state?room=${client.room}`, {
          headers: { 'X-Contract-Version': '2', Authorization: `Bearer ${client.token}` }
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).snapshot.players.length, 2);
        latencies.push(performance.now() - before);
      }));
      if (round < 9) await delay(Math.max(0, 1000 - (performance.now() - started)));
    }
    latencies.sort((a, b) => a - b);
    t.diagnostic(`本地400次HTTP读取全部成功，p95=${Math.ceil(latencies[Math.floor(latencies.length * 0.95)])}ms，最大=${Math.ceil(latencies.at(-1))}ms。仅代表本机房间读取基线。`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const room of roomIds) {
      await pool.query('DELETE FROM anxian.game_requests WHERE room_id=$1', [room]);
      await pool.query('DELETE FROM anxian.game_players WHERE room_id=$1', [room]);
      await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [room]);
    }
    await pool.end();
  }
});
