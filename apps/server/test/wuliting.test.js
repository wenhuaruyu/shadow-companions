import test from 'node:test';
import assert from 'node:assert/strict';
import { createCards, legalCardMoves, applyCards, settleCards, cardsSnapshot } from '../src/v2/wuliting.js';
import { beginCards, applyChapterGame, settleChapterGames } from '../src/v2/chapter-games.js';

const card = (value, group = 0) => ({ id: `${group}-${value}`, value, attribute: ['公函', '凭据', '人脉'][group], title: '测试凭证' });

test('十八张牌完整发放，对子和单张按同牌型比较，王站长手牌隐藏', () => {
  const game = createCards();
  assert.equal(new Set(game.hands.flat().map(card => card.id)).size, 18);
  assert.deepEqual(game.hands.map(hand => hand.length), [6, 6, 6]);
  const view = cardsSnapshot(game, 1000);
  assert.equal(view.hands.length, 2);
  assert.equal(view.wangCount, 6);
  assert.equal(view.hands.flat().length, 12);
  const hand = [card(2), card(2, 1), card(4)];
  assert.equal(legalCardMoves(hand, { cards: [card(1), card(1, 1)] }).length, 1);
  assert.equal(legalCardMoves(hand, { cards: [card(3)] }).length, 1);
});

test('越权和非法出牌被拒绝，两次过牌恢复首出，超时自动走牌', () => {
  const game = createCards();
  applyCards(game, 0, 'cards_ready', {}, 1000);
  assert.equal(game.startedAt, null);
  applyCards(game, 1, 'cards_ready', {}, 1000);
  game.hands = [[card(1), card(6)], [card(2), card(3)], [card(4), card(5)]];
  assert.throws(() => applyCards(game, 0, 'cards_play', { ids: ['0-2'] }, 1001));
  settleCards(game, 2200);
  assert.equal(game.turn, 1);
  assert.throws(() => applyCards(game, 0, 'cards_play', { ids: ['0-2', '0-2'] }, 2300));
  applyCards(game, 0, 'cards_play', { ids: [] }, 2300);
  applyCards(game, 1, 'cards_play', { ids: [] }, 2400);
  assert.equal(game.turn, 0);
  assert.equal(game.table, null);
  // Reconnection resolves all overdue turns and terminates within five minutes.
  settleCards(game, 400000);
  assert.equal(game.done, true);
});

test('协作奖励0、5、10同时写入两人双属性，结算只执行一次', () => {
  for (const reward of [0, 5, 10]) {
    const state = { chapter: 3, phase: 'event', records: [], players: [0, 1].map(() => ({ int: 5, str: 5 })) };
    beginCards(state);
    const game = state.cards;
    game.startedAt = 1000; game.turnAt = 1000;
    game.hands = [[card(1)], [card(2)], [card(3)]];
    game.plays = reward === 10 ? [1, 2] : [0, 0];
    const rewards = [];
    if (reward === 0) settleChapterGames(state, rewards, 2200);
    else {
      game.turn = 1;
      applyChapterGame(state, { seat: 0 }, { kind: 'cards_play', data: { ids: ['0-2'] }, attemptId: game.id, inputSeq: 0 }, rewards, 2000);
    }
    assert.equal(game.reward, reward);
    assert.equal(rewards.length, 4);
    assert.deepEqual(state.players.map(player => [player.int, player.str]), [[5 + reward, 5 + reward], [5 + reward, 5 + reward]]);
    assert.equal(state.phase, reward ? 'invest' : 'failed');
    assert.equal(settleChapterGames(state, rewards, 999999), false);
    assert.equal(rewards.length, 4);
  }
});
