import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { RoomService } from '../src/v2/rooms.js';
import { RpcRoomService } from '../src/v2/rpc.js';
import { GameplayService } from '../src/v2/gameplay.js';
import { createRoomServer } from '../src/v2/server.js';

const entry = () => ({ requestId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), contentVersion: 'mvp-two-sites-1' });
const signatures = {
  anxian_game_load: ['p_room', 'p_token_hash', 'p_request_id'],
  anxian_game_commit: ['p_room', 'p_token_hash', 'p_version', 'p_state', 'p_request_id', 'p_payload'],
  anxian_room_enter: ['p_request_id', 'p_token_hash', 'p_scope', 'p_payload', 'p_content_version', 'p_room', 'p_joining']
};
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

for (const mode of ['pg', 'rpc']) {
  test(`准备与阶段${mode}经HTTP验证身份、重放、并发及事务回滚`, { skip: !process.env.PG_TEST_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL, max: 5 });
    const gateway = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      const client = await pool.connect();
      try {
        const name = request.url.split('/').at(-1);
        if (!Object.hasOwn(signatures, name)) throw new Error('Unknown function');
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const parameters = JSON.parse(raw);
        const keys = signatures[name];
        await client.query('BEGIN');
        await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })]);
        const values = keys.map(key => typeof parameters[key] === 'object' && parameters[key] !== null
          ? JSON.stringify(parameters[key]) : parameters[key]);
        const result = await client.query(`SELECT public.${name}(${keys.map((_, index) => '$' + (index + 1)).join(',')}) AS result`, values);
        await client.query('COMMIT');
        response.end(JSON.stringify(result.rows[0].result));
      } catch (error) {
        await client.query('ROLLBACK');
        response.statusCode = 400;
        response.end(JSON.stringify({ code: `DATABASE_${error.code}`, message: error.message }));
      } finally { client.release(); }
    });
    const gatewayUrl = await listen(gateway);
    const core = mode === 'pg' ? new RoomService(pool, 'https://game.example.com')
      : new RpcRoomService(gatewayUrl, 'server-secret', 'https://game.example.com');
    const server = createRoomServer(pool, 'https://game.example.com');
    // Each adapter gets its normal HTTP server with the same gameplay boundary.
    const adapterServer = mode === 'pg' ? server : createRoomServer(null, 'https://game.example.com', core);
    const url = await listen(adapterServer);
    const roomIds = [];
    async function request(path, body, token) {
      const response = await fetch(url + path, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Contract-Version': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, ...await response.json() };
    }
    const state = async (room, seat = 0) => (await request(`/api/state?room=${room.id}`, undefined, room.tokens[seat])).snapshot;
    async function envelope(room, seat, kind, data = {}, extra = {}) {
      const snapshot = await state(room, seat);
      return { room: room.id, requestId: randomUUID(), kind, data,
        expectedVersion: snapshot.version, expectedPhase: snapshot.phase, chapter: snapshot.chapter, ...extra };
    }
    const send = (room, seat, body) => request('/api/action', body, room.tokens[seat]);
    async function action(room, seat, kind, data = {}, extra = {}) {
      const result = await send(room, seat, await envelope(room, seat, kind, data, extra));
      assert.equal(result.status, 200, JSON.stringify(result));
      return result;
    }
    async function room() {
      const host = entry();
      const created = await request('/api/create', host);
      assert.equal(created.status, 201);
      roomIds.push(created.id);
      const guest = { ...entry(), room: created.id };
      assert.equal((await request('/api/join', guest)).status, 201);
      return { id: created.id, tokens: [host.recoverySecret, guest.recoverySecret] };
    }
    try {
      const pair = await room();
      assert.equal((await request(`/api/instruction?room=${pair.id}`, undefined, pair.tokens[0])).status, 409);
      await action(pair, 0, 'ready', { ready: true });
      await action(pair, 0, 'ready', { ready: false });
      assert.equal((await state(pair)).players[0].ready, false);
      const firstReady = await envelope(pair, 0, 'ready', { ready: true });
      const otherReady = await envelope(pair, 1, 'ready', { ready: true });
      const raced = await Promise.all([send(pair, 0, firstReady), send(pair, 1, otherReady)]);
      assert.deepEqual(raced.map(item => item.status).sort(), [200, 409]);
      const loser = raced.findIndex(item => item.status === 409);
      assert.equal(raced[loser].code, 'VERSION_CONFLICT');
      assert.ok(raced[loser].currentVersion);
      const winningBody = loser === 0 ? otherReady : firstReady;
      const winningSeat = 1 - loser;
      const finalReady = await envelope(pair, loser, 'ready', { ready: true });
      // Fail the receipt write to prove role assignment and phase also roll back.
      await pool.query(`CREATE FUNCTION anxian.test_action_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`);
      await pool.query('CREATE TRIGGER test_action_failure BEFORE INSERT ON anxian.game_actions FOR EACH ROW EXECUTE FUNCTION anxian.test_action_failure()');
      const previousError = console.error;
      console.error = () => {};
      try { assert.equal((await send(pair, loser, finalReady)).status, 503); }
      finally {
        console.error = previousError;
        await pool.query('DROP TRIGGER test_action_failure ON anxian.game_actions');
        await pool.query('DROP FUNCTION anxian.test_action_failure()');
      }
      assert.equal((await state(pair)).phase, 'lobby');
      assert.equal((await request(`/api/instruction?room=${pair.id}`, undefined, pair.tokens[0])).status, 409);
      const starts = await Promise.all([send(pair, loser, finalReady), send(pair, loser, finalReady)]);
      assert.ok(starts.every(item => item.status === 200));
      assert.equal(starts.filter(item => item.replayed).length, 1);
      assert.equal((await state(pair)).phase, 'brief');
      const privateBefore = await Promise.all(pair.tokens.map(token => request(`/api/instruction?room=${pair.id}`, undefined, token)));
      assert.equal(privateBefore.filter(item => item.text.includes('秘密任务')).length, 1);
      assert.equal(privateBefore.filter(item => item.text.includes('封签与记录')).length, 1);
      const replay = await send(pair, winningSeat, winningBody);
      assert.equal(replay.replayed, true);
      assert.equal(replay.snapshot.phase, 'brief');
      assert.equal((await send(pair, winningSeat, { ...winningBody, data: { ready: false } })).code, 'REQUEST_ID_CONFLICT');
      assert.equal((await send(pair, 0, await envelope(pair, 0, 'ready', { ready: false }))).code, 'PHASE_MISMATCH');
      assert.equal((await send(pair, 0, await envelope(pair, 0, 'tutorial'))).code, 'PHASE_MISMATCH');
      assert.equal((await send(pair, 0, await envelope(pair, 0, 'instruction', {}, { seat: 1 }))).status, 400);
      assert.equal((await request(`/api/instruction?room=${pair.id}&seat=1`, undefined, pair.tokens[0])).status, 400);
      assert.equal((await request(`/api/instruction?room=${pair.id}`, undefined, entry().recoverySecret)).status, 401);
      const otherRoom = await room();
      assert.equal((await request(`/api/instruction?room=${otherRoom.id}`, undefined, pair.tokens[0])).status, 401);
      const sameInstruction = await Promise.all(pair.tokens.map(token => request(`/api/instruction?room=${pair.id}`, undefined, token)));
      assert.deepEqual(sameInstruction.map(item => item.text), privateBefore.map(item => item.text));
      const restarted = new GameplayService(core);
      assert.equal((await restarted.state(pair.id, pair.tokens[0])).phase, 'brief');
      assert.deepEqual(await restarted.instruction(pair.id, pair.tokens[0]), { title: privateBefore[0].title, text: privateBefore[0].text });
      for (const seat of [0, 1]) { await action(pair, seat, 'instruction'); await action(pair, seat, 'tutorial'); }
      assert.equal((await state(pair)).phase, 'map');
      const unchanged = await request(`/api/state?room=${pair.id}&knownVersion=${(await state(pair)).version}`, undefined, pair.tokens[0]);
      assert.equal(unchanged.changed, false);
      assert.equal(unchanged.snapshot, undefined);
      assert.equal((await send(pair, 0, await envelope(pair, 0, 'enter', {}, { chapter: 1 }))).code, 'PHASE_MISMATCH');
      await action(pair, 0, 'enter');
      assert.equal((await state(pair)).phase, 'map');
      await action(pair, 1, 'enter');
      assert.equal((await state(pair)).phase, 'story');
      await action(pair, 0, 'read');
      assert.equal((await state(pair)).phase, 'story');
      await action(pair, 1, 'read');
      const finalState = await state(pair);
      assert.equal(finalState.phase, 'event');
      assert.equal(finalState.chapter, 0);
      assert.ok(!/secret|courier|秘密任务|叛徒|token_hash|role/.test(JSON.stringify(finalState)));
      assert.equal((await send(pair, 0, await envelope(pair, 0, 'start', { type: 'int' }))).status, 400);
      // Existing service callers read the current state as well.
      assert.equal((await core.state(pair.id, pair.tokens[0])).phase, 'event');
      for (const role of [null, 'anon', 'authenticated']) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          if (role !== null) await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role })]);
          await assert.rejects(client.query('SELECT public.anxian_game_load($1,$2,NULL)', [pair.id, '0'.repeat(64)]), { code: '42501' });
        } finally { await client.query('ROLLBACK'); client.release(); }
      }
    } finally {
      await close(adapterServer); await close(gateway);
      for (const id of roomIds) {
        await pool.query('DELETE FROM anxian.game_actions WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_requests WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_players WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [id]);
      }
      await pool.end();
    }
  });
}

test('显式撤销CloudBase默认的客户端函数执行权限', { skip: !process.env.PG_TEST_URL }, async () => {
  const { readFile } = await import('node:fs/promises');
  const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL });
  try {
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    END $$`);
    await pool.query('GRANT EXECUTE ON FUNCTION public.anxian_game_load(text,text,text), public.anxian_game_commit(text,text,bigint,jsonb,text,text) TO anon,authenticated');
    await pool.query(await readFile(new URL('../../../cloudbase/migrations/20261107160001_restrict_gameplay_rpc.sql', import.meta.url), 'utf8'));
    const result = await pool.query(`SELECT has_function_privilege(r.rolname,p.oid,'EXECUTE') AS allowed
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
      WHERE n.nspname='public' AND p.proname IN ('anxian_game_load','anxian_game_commit')
        AND r.rolname IN ('anon','authenticated')`);
    assert.equal(result.rows.length, 4);
    assert.ok(result.rows.every(row => row.allowed === false));
  } finally { await pool.end(); }
});
