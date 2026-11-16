import test from 'node:test';
import assert from 'node:assert/strict';
import { createTea, settleTea, teaReward, applyTea, teaSnapshot } from '../src/v2/tea-games.js';

const assignments = { A: 'west', B: 'north', C: 'south', D: 'inbox', E: 'inbox', F: 'inbox' };
test('第三章电码在记忆前隐藏，20秒自动收起，查看5秒和三档奖励', () => {
  for (const mistakes of [0, 1, 2]) {
    const attempt = { type: 'int', startedAt: 1000, tea: createTea('int') };
    assert.equal(teaSnapshot(attempt, 1000).code, undefined);
    applyTea(attempt, 'tea_archive', { assignments }, 1000);
    assert.equal(teaSnapshot(attempt, 1000).signal, undefined);
    settleTea(attempt, 21000);
    assert.equal(attempt.tea.phase, 'morse');
    assert.equal(teaSnapshot(attempt, 21000).routeCode, undefined);
    for (let i = 0; i < mistakes; i++) applyTea(attempt, 'tea_decode', { code: '000' }, 21000);
    assert.equal(teaReward(attempt), 0);
    applyTea(attempt, 'tea_peek', {}, 21000);
    assert.throws(() => applyTea(attempt, 'tea_decode', { code: attempt.tea.code }, 25999));
    applyTea(attempt, 'tea_decode', { code: attempt.tea.code }, 26000);
    assert.equal(teaSnapshot(attempt, 26000).routeCode, attempt.tea.code);
    assert.equal(applyTea(attempt, 'tea_route', { route: 'south' }, 26000), true);
    assert.equal(teaReward(attempt), mistakes ? 5 : 10);
  }
});
test('第三章射击和闪避独立校验，过期输入、重复目标与伪造奖励被拒绝', () => {
  const attempt = { type: 'str', startedAt: 10000, tea: createTea('str') };
  const first = attempt.tea.schedule.find(item => !item.friendly);
  applyTea(attempt, 'tea_shot', { targetId: first.id, elapsed: first.at + 50 }, 10000 + first.at + 100);
  assert.equal(attempt.tea.hits, 1);
  assert.throws(() => applyTea(attempt, 'tea_shot', { targetId: first.id, elapsed: first.at + 450 }, 10000 + first.at + 450));
  assert.throws(() => applyTea(attempt, 'tea_shot', { targetId: null, elapsed: 0 }, 20000));
  const cue = attempt.tea.dodges[0];
  applyTea(attempt, 'tea_dodge', { cueId: cue.id, direction: cue.direction, elapsed: cue.at + 100 }, 10000 + cue.at + 200);
  assert.equal(attempt.tea.evaded, 1);
  assert.throws(() => applyTea(attempt, 'tea_dodge', { cueId: cue.id, direction: cue.direction, elapsed: cue.at + 200 }, 10000 + cue.at + 300));
  const second = attempt.tea.dodges[1];
  settleTea(attempt, 10000 + second.at + second.windowMs + 1500);
  assert.equal(attempt.tea.wounds, 1);
  assert.throws(() => applyTea(attempt, 'finish', { reward: 10, elapsed: second.at }, 10000 + second.at));
  Object.assign(attempt.tea, { hits: 63, friendlyHits: 0, empty: 0, wounds: 0 });
  assert.equal(teaReward(attempt), 10);
  attempt.tea.wounds = 1;
  assert.equal(teaReward(attempt), 5);
  attempt.tea.hits = 10;
  assert.equal(teaReward(attempt), 0);
});
