import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { RoomService } from '../src/v2/rooms.js';
import { GameplayService } from '../src/v2/gameplay.js';

test('第四章真实数据库出牌、恢复、双属性到账和请求重放', { skip: !process.env.PG_TEST_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL });
  const store = new RoomService(pool, 'http://localhost');
  let now = Date.now();
  const service = new GameplayService(store, () => now);
  const entry = () => ({ requestId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), contentVersion: 'mvp-two-sites-1' });
  const host = entry(), guest = entry();
  const created = await service.enter({ ...host, rulesVersion: 'chapter-games-3' });
  const room = created.id;
  const tokens = [host.recoverySecret, guest.recoverySecret];
  async function body(seat, kind, data = {}) {
    const view = await service.state(room, tokens[seat]);
    return { room, requestId: randomUUID(), kind, data, chapter: view.chapter,
      expectedVersion: view.version, expectedPhase: view.phase,
      ...(view.attempt ? { attemptId: view.attempt.id, inputSeq: view.attempt.inputSeq + 1 } : {}) };
  }
  async function act(seat, kind, data) { return service.action(await body(seat, kind, data), tokens[seat]); }
  try {
    await service.enter({ ...guest, room }, true);
    const document = await store.loadGame(room, tokens[0]);
    document.state.chapter = 3;
    await store.commitGame(document, tokens[0], []);
    for (const seat of [0, 1]) await act(seat, 'ready', { ready: true });
    for (const seat of [0, 1]) { await act(seat, 'instruction'); await act(seat, 'tutorial'); }
    for (const seat of [0, 1]) await act(seat, 'enter');
    for (const seat of [0, 1]) await act(seat, 'read');
    assert.equal((await service.state(room, tokens[0])).cards.hands.length, 2);
    await act(0, 'cards_ready'); await act(1, 'cards_ready');
    const fixture = await store.loadGame(room, tokens[0]);
    const cards = fixture.state.cards;
    // Keep a valid dealt card and force a one-card winning hand for the final move.
    cards.turn = 1;
    cards.table = null;
    cards.hands[1] = cards.hands[1].slice(0, 1);
    cards.plays = [1, 2];
    await store.commitGame(fixture, tokens[0], []);
    const winning = await body(0, 'cards_play', { ids: [cards.hands[1][0].id] });
    const result = await service.action(winning, tokens[0]);
    assert.equal(result.snapshot.phase, 'invest');
    assert.equal(result.snapshot.cards.reward, 10);
    const replay = await service.action(winning, tokens[0]);
    assert.equal(replay.replayed, true);
    const restored = await new GameplayService(store, () => now).state(room, tokens[1]);
    assert.deepEqual(restored.players.map(player => [player.int, player.str]), [[15, 15], [15, 15]]);
    assert.equal(Number((await pool.query('SELECT count(*) FROM anxian.resource_ledger WHERE room_id=$1', [room])).rows[0].count), 4);
    await act(0, 'invest', { int: 3, str: 2 });
    await act(1, 'invest', { int: 3, str: 2 });
    await act(0, 'continue'); await act(1, 'continue');
    assert.equal((await service.state(room, tokens[0])).phase, 'complete');
  } finally {
    for (const table of ['resource_ledger', 'game_actions', 'game_requests', 'game_players']) await pool.query(`DELETE FROM anxian.${table} WHERE room_id=$1`, [room]);
    await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [room]);
    await pool.end();
  }
});
