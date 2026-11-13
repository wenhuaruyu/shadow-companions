import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { RoomService } from '../src/v2/rooms.js';
import { RpcRoomService } from '../src/v2/rpc.js';
import { GameplayService } from '../src/v2/gameplay.js';
import { createRoomServer } from '../src/v2/server.js';
import { CHAPTER_RULES } from '../src/v2/chapter-games.js';
import { createRun, step, directions } from '../../web/src/games/back-alley.js';
import { people, exit, canMove } from '../src/v2/cooperative.js';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
function alleyPath() {
  const queue = [[createRun(), []]], seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    const [run, path] = queue[index];
    if (run.checkpoint === 3) return path;
    if (run.done) continue;
    for (const direction of [null, ...Object.keys(directions)]) {
      const next = step(structuredClone(run), direction);
      if (next.caught) continue;
      const key = [...next.position, next.checkpoint, next.tick % 72].join(',');
      if (!seen.has(key)) { seen.add(key); queue.push([next, [...path, direction]]); }
    }
  }
  throw new Error('No alley route');
}
function cooperativePath(from, to) {
  const queue = [[from, []]], seen = new Set([String(from)]);
  for (let index = 0; index < queue.length; index++) {
    const [position, path] = queue[index];
    if (String(position) === String(to)) return path;
    for (const [direction, [dx, dy]] of Object.entries(directions)) {
      const next = [position[0] + dx, position[1] + dy];
      if (canMove(position, next) && !seen.has(String(next))) { seen.add(String(next)); queue.push([next, [...path, direction]]); }
    }
  }
  throw new Error('No cooperative route');
}

for (const mode of ['pg', 'rpc']) {
  test(`主流程${mode}接入三个小游戏、身份隔离、奖励事务及共同投入`, { skip: !process.env.PG_TEST_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL });
    const signatures = {
      anxian_room_enter: ['p_request_id','p_token_hash','p_scope','p_payload','p_content_version','p_room','p_joining'],
      anxian_game_load: ['p_room','p_token_hash','p_request_id'],
      anxian_game_reward_commit: ['p_room','p_token_hash','p_version','p_state','p_rewards','p_request_id','p_payload'],
    };
    const gateway = createServer(async (request, response) => {
      const client = await pool.connect();
      try {
        const name = request.url.split('/').at(-1);
        if (!Object.hasOwn(signatures, name)) throw new Error('Unknown function');
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw);
        await client.query('BEGIN');
        await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })]);
        const values = signatures[name].map(key => body[key] !== null && typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key]);
        const result = await client.query(`SELECT public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) AS result`, values);
        await client.query('COMMIT');
        response.end(JSON.stringify(result.rows[0].result));
      } catch (error) {
        await client.query('ROLLBACK'); response.statusCode = 400;
        response.end(JSON.stringify({ code: `DATABASE_${error.code}`, message: error.message }));
      } finally { client.release(); }
    });
    const gatewayUrl = await listen(gateway);
    const store = mode === 'pg' ? new RoomService(pool, 'https://game.example.com') : new RpcRoomService(gatewayUrl, 'test-service-token', 'https://game.example.com');
    let now = Date.now();
    const game = new GameplayService(store, () => now);
    const server = createRoomServer(pool, 'https://game.example.com', game);
    const origin = await listen(server);
    const rooms = [];
    const entry = () => ({ requestId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), contentVersion: 'mvp-two-sites-1' });
    async function request(path, body, token) {
      const response = await fetch(origin + path, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Contract-Version': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, ...await response.json() };
    }
    async function room() {
      const host = { ...entry(), rulesVersion: CHAPTER_RULES }, guest = entry();
      const created = await request('/api/create', host); assert.equal(created.status, 201, JSON.stringify(created));
      rooms.push(created.id);
      assert.equal((await request('/api/create', host)).id, created.id);
      const changed = await request('/api/create', { ...host, rulesVersion: undefined });
      assert.equal(changed.code, 'REQUEST_ID_CONFLICT');
      assert.equal((await request('/api/join', { ...guest, room: created.id })).status, 201);
      return { id: created.id, tokens: [host.recoverySecret, guest.recoverySecret] };
    }
    const state = async (room, seat = 0) => (await request(`/api/state?room=${room.id}`, null, room.tokens[seat])).snapshot;
    async function envelope(room, seat, kind, data = {}) {
      const snapshot = await state(room, seat);
      return { room: room.id, requestId: randomUUID(), kind, data, chapter: snapshot.chapter,
        expectedVersion: snapshot.version, expectedPhase: snapshot.phase,
        ...(snapshot.attempt ? { attemptId: snapshot.attempt.id, inputSeq: snapshot.attempt.inputSeq + 1 } : {}) };
    }
    const send = (room, seat, body) => request('/api/action', body, room.tokens[seat]);
    async function action(room, seat, kind, data = {}) {
      const result = await send(room, seat, await envelope(room, seat, kind, data));
      assert.equal(result.status, 200, JSON.stringify(result)); return result.snapshot;
    }
    async function reachEvent(room) {
      for (const seat of [0, 1]) await action(room, seat, 'ready', { ready: true });
      for (const seat of [0, 1]) { await action(room, seat, 'instruction'); await action(room, seat, 'tutorial'); }
      for (const seat of [0, 1]) await action(room, seat, 'enter');
      for (const seat of [0, 1]) await action(room, seat, 'read');
    }
    try {
      const main = await room(); await reachEvent(main);
      assert.equal((await state(main)).rulesVersion, CHAPTER_RULES);
      const beforeInstructions = await Promise.all(main.tokens.map(token => game.instruction(main.id, token)));
      const initial = await action(main, 0, 'start', { type: 'int' });
      assert.equal(initial.attempt.gameId, 'chapter-1-intelligence'); assert.equal(initial.attempt.duration, 90000);
      assert.equal((await state(main, 1)).attempt, null);
      assert.equal((await send(main, 0, await envelope(main, 0, 'answers', { answers: [1,0,2] }))).code, 'INVALID_INPUT');
      await action(main, 0, 'judge', { suspectId: 'su' });
      assert.equal((await send(main, 0, await envelope(main, 0, 'judge', { suspectId: 'su' }))).code, 'SUSPECT_EXCLUDED');
      const restored = new GameplayService(store, () => now);
      assert.deepEqual((await restored.state(main.id, main.tokens[0])).attempt.guesses, ['su']);
      await action(main, 0, 'judge', { suspectId: 'mai' });
      const judgment = await envelope(main, 0, 'judge', { suspectId: 'chen' });
      const judged = await Promise.all([send(main, 0, judgment), send(main, 0, judgment)]);
      assert.ok(judged.every(result => result.status === 200));
      assert.equal((await state(main)).players[0].int, 8);
      const started = await action(main, 1, 'start', { type: 'str' });
      assert.equal(started.attempt.gameId, 'chapter-1-strength');
      assert.equal((await send(main, 1, await envelope(main, 1, 'alley_move', { direction: 'right' }))).code, 'MOVE_COOLDOWN');
      for (const direction of alleyPath()) {
        now += 200;
        if (direction) await action(main, 1, 'alley_move', { direction });
        else await state(main, 1);
      }
      const completed = await state(main, 1);
      assert.equal(completed.attempt.reward, 10); assert.equal(completed.phase, 'invest');
      assert.equal(completed.players[1].str, 15);
      assert.equal(Number((await pool.query('SELECT count(*) FROM anxian.resource_ledger WHERE room_id=$1', [main.id])).rows[0].count), 2);

      const debit = await envelope(main, 0, 'invest', { int: 5, str: 0 });
      await send(main, 0, debit);
      await send(main, 0, debit);
      assert.equal((await state(main)).players[0].int, 3);
      assert.equal((await send(main, 0, await envelope(main, 0, 'invest', { int: 1, str: 0 }))).code, 'ALREADY_INVESTED');
      await action(main, 1, 'invest', { int: 0, str: 5 });
      assert.equal((await state(main)).phase, 'result');
      await action(main, 0, 'continue');
      await action(main, 1, 'continue');
      assert.equal((await state(main)).chapter, 1);
      for (const seat of [0,1]) await action(main, seat, 'enter');
      for (const seat of [0,1]) await action(main, seat, 'read');
      const cooperative = await state(main);
      assert.equal(cooperative.attempt.id, (await state(main, 1)).attempt.id);
      assert.equal(cooperative.cooperative.phase, 'coop-lobby');
      await action(main, 0, 'coop_role', { role: 'int' });
      assert.equal((await send(main, 1, await envelope(main, 1, 'coop_role', { role: 'int' }))).code, 'ROLE_TAKEN');
      await action(main, 1, 'coop_role', { role: 'str' });
      await Promise.all([action(main, 0, 'coop_ready', { ready: true }), action(main, 1, 'coop_ready', { ready: true })]);
      assert.equal((await state(main, 1)).cooperative.grid.flatMap(row => [...row]).filter(cell => cell !== '?').length, 1);
      assert.equal((await send(main, 0, await envelope(main, 0, 'coop_move', { direction: 'right' }))).status, 403);
      await action(main, 0, 'coop_light', { from: [0,0], to: [4,0] });
      assert.equal((await state(main, 1)).cooperative.grid[0][4], '.');
      const publicState = JSON.stringify(await state(main, 1));
      assert.ok(!/secret|courier|token_hash|秘密任务/.test(publicState));
      now += 20000;
      assert.equal((await state(main, 1)).cooperative.grid[0][4], '?');
      let position = [0,0];
      for (const target of [...people.map(person => person.position), exit]) {
        for (const direction of cooperativePath(position, target)) {
          now += 200;
          const snapshot = await action(main, 1, 'coop_move', { direction });
          position = snapshot.cooperative.position;
        }
      }
      const end = await state(main);
      assert.equal(end.phase, 'invest'); assert.ok(end.players.every(player => player.event.done));
      assert.equal(end.players[0].int, 13); assert.equal(end.players[1].str, 20);
      assert.equal(end.attempt.reward, 10);
      assert.equal(Number((await pool.query('SELECT count(*) FROM anxian.resource_ledger WHERE room_id=$1', [main.id])).rows[0].count), 4);
      await action(main, 0, 'invest', { int: 6, str: 0 });
      await action(main, 1, 'invest', { int: 0, str: 4 });
      await action(main, 0, 'continue');
      const final = await action(main, 1, 'continue');
      assert.equal(final.phase, 'complete'); assert.equal(final.ended, true);
      const afterInstructions = await Promise.all(main.tokens.map(token => game.instruction(main.id, token)));
      assert.deepEqual(afterInstructions, beforeInstructions);

      // Deadline wins over a late judgment and repeated reads do not duplicate rewards.
      const expired = await room(); await reachEvent(expired);
      await action(expired, 0, 'start', { type: 'int' });
      const late = await envelope(expired, 0, 'judge', { suspectId: 'chen' }); now += 90000;
      assert.equal((await send(expired, 0, late)).status, 409);
      assert.equal((await state(expired)).attempt.reward, 0);
      await Promise.all([state(expired), state(expired)]);
      assert.equal(Number((await pool.query('SELECT count(*) FROM anxian.resource_ledger WHERE room_id=$1', [expired.id])).rows[0].count), 1);
    } finally {
      await close(server); await close(gateway);
      for (const id of rooms) {
        for (const table of ['resource_ledger','game_actions','game_requests','game_players']) await pool.query(`DELETE FROM anxian.${table} WHERE room_id=$1`, [id]);
        await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [id]);
      }
      await pool.end();
    }
  });
}
