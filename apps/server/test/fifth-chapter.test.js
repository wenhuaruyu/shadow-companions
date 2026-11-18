import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameplayService } from '../src/v2/gameplay.js';

test('第四章共同确认后进入第五章，双方读完剧情才完成', async () => {
  const room = randomUUID();
  const tokens = ['a'.repeat(43), 'b'.repeat(43)];
  let version = 1;
  let state = { rulesVersion: 'chapter-games-3', chapter: 3, phase: 'result', records: [{ chapter: 3, success: true }],
    players: [0, 1].map(() => ({ int: 10, str: 10, continued: false, attempt: null })) };
  const store = {
    async loadGame(id, token) {
      return { id, version, contentVersion: 'mvp-two-sites-1', playerCount: 2, seat: tokens.indexOf(token), state: structuredClone(state) };
    },
    async commitGame(document) {
      state = structuredClone(document.state);
      return { appliedVersion: ++version };
    },
  };
  const game = new GameplayService(store);
  async function action(seat, kind) {
    return game.action({ room, requestId: randomUUID(), kind, data: {}, chapter: state.chapter,
      expectedVersion: version, expectedPhase: state.phase }, tokens[seat]);
  }
  await action(0, 'continue');
  assert.equal(state.phase, 'result');
  await action(1, 'continue');
  assert.equal(state.chapter, 4);
  assert.equal(state.phase, 'map');
  await action(0, 'enter');
  await action(1, 'enter');
  assert.equal(state.phase, 'story');
  await action(0, 'read');
  assert.equal(state.phase, 'story');
  await action(1, 'read');
  assert.equal(state.phase, 'complete');
});
