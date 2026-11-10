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
  anxian_game_reward_commit: ['p_room', 'p_token_hash', 'p_version', 'p_state', 'p_rewards', 'p_request_id', 'p_payload'],
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
  test(`第三阶段${mode}经HTTP验证阶段、隐私、计时、幂等和奖励回滚`, { skip: !process.env.PG_TEST_URL }, async () => {
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
    let now = Date.now();
    const game = new GameplayService(core, () => now);
    const server = createRoomServer(pool, 'https://game.example.com', game);
    const url = await listen(server);
    const roomIds = [];
    async function request(path, body, token) {
      const response = await fetch(url + path, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Contract-Version': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, ...await response.json() };
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
    const state = async (room, seat = 0) => (await request(`/api/state?room=${room.id}`, undefined, room.tokens[seat])).snapshot;
    async function envelope(room, seat, kind, data = {}, extra = {}) {
      const snapshot = await state(room, seat);
      return { room: room.id, requestId: randomUUID(), kind, data,
        expectedVersion: snapshot.version, expectedPhase: snapshot.phase, chapter: snapshot.chapter,
        ...(snapshot.attempt ? { attemptId: snapshot.attempt.id } : {}), ...extra };
    }
    const send = (room, seat, body) => request('/api/action', body, room.tokens[seat]);
    async function action(room, seat, kind, data = {}, extra = {}) {
      const result = await send(room, seat, await envelope(room, seat, kind, data, extra));
      assert.equal(result.status, 200, JSON.stringify(result));
      return result;
    }
    async function reachEvent(room) {
      for (const seat of [0, 1]) await action(room, seat, 'ready', { ready: true });
      for (const seat of [0, 1]) {
        await action(room, seat, 'instruction');
        await action(room, seat, 'tutorial');
      }
      for (const seat of [0, 1]) await action(room, seat, 'enter');
      for (const seat of [0, 1]) await action(room, seat, 'read');
    }
    try {
      const room1 = await room();
      assert.equal((await request(`/api/instruction?room=${room1.id}`, undefined, room1.tokens[0])).status, 409);
      const firstReady = await envelope(room1, 0, 'ready', { ready: true });
      const otherReady = await envelope(room1, 1, 'ready', { ready: true });
      const raced = await Promise.all([send(room1, 0, firstReady), send(room1, 1, otherReady)]);
      assert.deepEqual(raced.map(item => item.status).sort(), [200, 409]);
      const loser = raced.findIndex(item => item.status === 409);
      assert.equal(raced[loser].code, 'VERSION_CONFLICT');
      assert.ok(raced[loser].currentVersion);
      await action(room1, loser, 'ready', { ready: true });
      const replay = await send(room1, 0, firstReady);
      // A losing request was never committed and must still conflict on stale version.
      assert.equal(replay.status, raced[0].status === 200 ? 200 : 409);
      const instructions = await Promise.all(room1.tokens.map(token => request(`/api/instruction?room=${room1.id}`, undefined, token)));
      assert.equal(instructions.filter(item => item.text.includes('秘密任务')).length, 1);
      assert.equal(instructions.filter(item => item.text.includes('封签与记录')).length, 1);
      const publicState = JSON.stringify(await state(room1));
      assert.ok(!/secret|courier|秘密任务|叛徒|token_hash|role/.test(publicState));
      assert.equal((await request(`/api/instruction?room=${room1.id}`, undefined, entry().recoverySecret)).status, 401);
      const room2 = await room();
      assert.equal((await request(`/api/instruction?room=${room2.id}`, undefined, room1.tokens[0])).status, 401);
      assert.equal((await send(room1, 0, await envelope(room1, 0, 'tutorial'))).status, 409);
      for (const seat of [0, 1]) { await action(room1, seat, 'instruction'); await action(room1, seat, 'tutorial'); }
      for (const seat of [0, 1]) await action(room1, seat, 'enter');
      for (const seat of [0, 1]) await action(room1, seat, 'read');
      const start = await envelope(room1, 0, 'start', { type: 'int' });
      const starts = await Promise.all([send(room1, 0, start), send(room1, 0, start)]);
      assert.ok(starts.every(item => item.status === 200));
      assert.equal(starts[0].snapshot.attempt.id, starts[1].snapshot.attempt.id);
      assert.equal(starts.filter(item => item.replayed).length, 1);
      const changedStart = { ...start, data: { type: 'str' } };
      assert.equal((await send(room1, 0, changedStart)).code, 'REQUEST_ID_CONFLICT');
      assert.equal((await send(room1, 0, await envelope(room1, 0, 'start', { type: 'str' }))).code, 'ACTION_POINT_USED');
      await action(room1, 0, 'answers', { answers: [1, 0, 2] }, { inputSeq: 1 });
      assert.equal((await send(room1, 0, await envelope(room1, 0, 'answers', { answers: [null, null, null] }, { inputSeq: 0 }))).code, 'STALE_INPUT');
      assert.equal((await state(room1, 1)).attempt, null);
      assert.equal((await state(room1, 1)).questions, null);
      const restarted = new GameplayService(core, () => now);
      assert.deepEqual((await restarted.state(room1.id, room1.tokens[0])).attempt.answers, [1, 0, 2]);
      const finishBody = await envelope(room1, 0, 'finish');
      // Force a failure after the room update would have been computed, before commit.
      await pool.query(`CREATE FUNCTION anxian.test_reward_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`);
      await pool.query('CREATE TRIGGER test_reward_failure BEFORE INSERT ON anxian.resource_ledger FOR EACH ROW EXECUTE FUNCTION anxian.test_reward_failure()');
      const oldError = console.error;
      console.error = () => {};
      try { assert.equal((await send(room1, 0, finishBody)).status, 503); }
      finally { console.error = oldError; await pool.query('DROP TRIGGER test_reward_failure ON anxian.resource_ledger'); await pool.query('DROP FUNCTION anxian.test_reward_failure()'); }
      assert.equal((await state(room1)).players[0].int, 5);
      assert.equal((await state(room1)).attempt.done, false);
      const finished = await Promise.all([send(room1, 0, finishBody), send(room1, 0, finishBody)]);
      assert.ok(finished.every(item => item.status === 200));
      assert.equal((await state(room1)).players[0].int, 15);
      const ledger = await pool.query('SELECT count(*) FROM anxian.resource_ledger WHERE room_id=$1 AND seat=0', [room1.id]);
      assert.equal(Number(ledger.rows[0].count), 1);
      const strength = (await action(room1, 1, 'start', { type: 'str' })).snapshot.attempt;
      assert.equal((await send(room1, 1, await envelope(room1, 1, 'hit', { opportunity: 0, zone: 0 }, { inputSeq: 1 }))).code, 'OPPORTUNITY_CLOSED');
      now += 3000;
      const wrongZone = (strength.sequence[0] + 1) % 3;
      await action(room1, 1, 'hit', { opportunity: 0, zone: wrongZone }, { inputSeq: 1 });
      assert.equal((await send(room1, 1, await envelope(room1, 1, 'hit', { opportunity: 0, zone: strength.sequence[0] }, { inputSeq: 2 }))).code, 'OPPORTUNITY_USED');
      now += 2000;
      await action(room1, 1, 'hit', { opportunity: 1, zone: strength.sequence[1] }, { inputSeq: 2 });
      assert.equal((await send(room1, 1, await envelope(room1, 1, 'finish'))).code, 'ATTEMPT_RUNNING');
      now += 20000;
      const expired = await state(room1, 1);
      assert.equal(expired.attempt.done, true);
      assert.equal(expired.attempt.reward, 1);
      assert.equal(expired.phase, 'invest');
      assert.equal(expired.players[1].str, 6);
      await Promise.all([state(room1), state(room1, 1)]);
      assert.equal(Number((await pool.query('SELECT count(*) FROM anxian.resource_ledger WHERE room_id=$1', [room1.id])).rows[0].count), 2);
      // All intelligence score bands, abandonment, and timeout use the saved draft.
      for (let correct = 0; correct <= 3; correct++) {
        const scoringRoom = await room();
        await reachEvent(scoringRoom);
        await action(scoringRoom, 0, 'start', { type: 'int' });
        const answers = [1, 0, 2].map((answer, index) => index < correct ? answer : null);
        await action(scoringRoom, 0, 'answers', { answers }, { inputSeq: 1 });
        if (correct === 2) now += 60000;
        else await action(scoringRoom, 0, correct === 1 ? 'abandon' : 'finish');
        assert.equal((await state(scoringRoom)).attempt.reward, [0, 3, 6, 10][correct]);
      }
      // Public RPCs refuse missing claims, even when a valid player hash is supplied.
      await assert.rejects(pool.query('SELECT public.anxian_game_load($1,$2,NULL)', [room1.id, '0'.repeat(64)]), { code: '42501' });
    } finally {
      await close(server); await close(gateway);
      for (const id of roomIds) {
        await pool.query('DELETE FROM anxian.resource_ledger WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_actions WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_requests WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_players WHERE room_id=$1', [id]);
        await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [id]);
      }
      await pool.end();
    }
  });
}
