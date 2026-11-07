import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { RpcRoomService } from '../src/v2/rpc.js';
import { CONTENT_VERSION, tokenDigest } from '../src/v2/rooms.js';

const entry = () => ({ requestId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), contentVersion: CONTENT_VERSION });

test('RPC拒绝不安全地址，并隐藏网关凭证错误', async () => {
  assert.throws(() => new RpcRoomService('http://example.com/rpc', 'secret', 'https://game.example.com'));
  const service = new RpcRoomService('https://gateway.example.com/rpc', 'secret', 'https://game.example.com',
    async () => new Response(JSON.stringify({ code: '42501', message: 'private-secret' }), { status: 403 }));
  const diagnostics = [];
  const previousError = console.error;
  console.error = line => diagnostics.push(line);
  try {
    await assert.rejects(service.enter(entry()), error => error.code === 'RPC_UPSTREAM_FAILURE' && !error.message.includes('private-secret'));
    assert.equal(diagnostics.length, 1);
    assert.ok(!diagnostics[0].includes('private-secret'));
    assert.ok(!diagnostics[0].includes('Bearer'));
  } finally {
    console.error = previousError;
  }
});

test('RPC首次部署可启动，邀请地址未配置时拒绝创建', async () => {
  const service = new RpcRoomService('https://gateway.example.com/rpc', 'secret', undefined,
    async () => { throw new Error('配置缺失时不得调用网关'); });
  await assert.rejects(service.enter(entry()), { code: 'PUBLIC_ORIGIN_REQUIRED', status: 503 });
});

test('RPC通过真实PostgreSQL验证角色、并发去重和失败回滚', { skip: !process.env.PG_TEST_URL }, async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL, max: 5 });
  const roomIds = new Set();
  const args = ['p_request_id', 'p_token_hash', 'p_scope', 'p_payload', 'p_content_version', 'p_room', 'p_joining'];
  async function invoke(name, parameters, role) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (role !== null) await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role })]);
      const keys = name === 'anxian_room_enter' ? args : ['p_room', 'p_token_hash'];
      const result = await client.query(`SELECT public.${name}(${keys.map((_, index) => '$' + (index + 1)).join(',')}) AS result`, keys.map(key => parameters[key]));
      await client.query('COMMIT');
      return result.rows[0].result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  const gateway = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      const name = request.url.split('/').at(-1);
      if (!['anxian_room_enter', 'anxian_room_state'].includes(name)) throw new Error('Unknown RPC');
      const role = request.headers.authorization === 'Bearer test-service-token' ? 'service_role' : 'anon';
      response.end(JSON.stringify(await invoke(name, JSON.parse(text), role)));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ code: error.code, message: error.message }));
    }
  });
  await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(0, '127.0.0.1', resolve); });
  const service = new RpcRoomService(`http://127.0.0.1:${gateway.address().port}/rpc`, 'test-service-token', 'https://game.example.com');
  try {
    for (const role of [null, 'anon', 'authenticated']) {
      await assert.rejects(invoke('anxian_room_state', { p_room: 'room', p_token_hash: '0'.repeat(64) }, role), { code: '42501' });
      await assert.rejects(invoke('anxian_room_enter', Object.fromEntries(args.map(key => [key, null])), role), { code: '42501' });
    }
    const body = entry();
    const hosts = await Promise.all([service.enter(body), service.enter(body)]);
    roomIds.add(hosts[0].id);
    assert.equal(hosts[0].id, hosts[1].id);
    assert.equal(hosts.filter(host => host.replayed).length, 1);
    const guest = { ...entry(), room: hosts[0].id };
    const guests = await Promise.all([service.enter(guest, true), service.enter(guest, true)]);
    assert.equal(guests[0].seat, 1);
    assert.equal(guests[1].seat, 1);
    await assert.rejects(service.enter({ ...entry(), room: guest.room }, true), { code: 'ROOM_FULL' });
    const snapshot = await service.state(guest.room, body.recoverySecret);
    assert.equal(snapshot.players.length, 2);
    assert.ok(!JSON.stringify(snapshot).includes(tokenDigest(body.recoverySecret)));
    await assert.rejects(service.state(guest.room, entry().recoverySecret), { code: 'INVALID_CREDENTIAL' });
    const expiring = await service.enter(entry());
    roomIds.add(expiring.id);
    await pool.query('UPDATE anxian.game_rooms SET created_at=$1 WHERE id=$2', [Date.now() - 900001, expiring.id]);
    await assert.rejects(service.enter({ ...entry(), room: expiring.id }, true), { code: 'INVITE_EXPIRED' });
    // Test-only trigger fails after player insertion, before receipt persistence.
    await pool.query(`CREATE FUNCTION anxian.test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected receipt failure'; END; $$;
      CREATE TRIGGER test_fail_receipt BEFORE INSERT ON anxian.game_requests
      FOR EACH ROW EXECUTE FUNCTION anxian.test_fail_receipt();`);
    const before = await pool.query('SELECT count(*) FROM anxian.game_rooms');
    try {
      await assert.rejects(service.enter(entry()));
      const after = await pool.query('SELECT count(*) FROM anxian.game_rooms');
      assert.equal(after.rows[0].count, before.rows[0].count);
    } finally {
      await pool.query('DROP TRIGGER test_fail_receipt ON anxian.game_requests; DROP FUNCTION anxian.test_fail_receipt();');
    }
  } finally {
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    for (const room of roomIds) {
      await pool.query('DELETE FROM anxian.game_requests WHERE room_id=$1', [room]);
      await pool.query('DELETE FROM anxian.game_players WHERE room_id=$1', [room]);
      await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [room]);
    }
    await pool.end();
  }
});
