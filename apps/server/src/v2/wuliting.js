import { randomInt, randomUUID } from 'node:crypto';
import { ApiError } from './rooms.js';

const attributes = ['公函', '凭据', '人脉'];
const titles = [
  ['赈济证明', '运输批文', '商会函件', '战区公函', '长官手令', '特别通行证'],
  ['货物清单', '仓库收据', '药品账册', '英文提单', '后勤印章', '签收底册'],
  ['商号担保', '洋行联络', '交通员口信', '联络站证明', '上级问询', '长官来电'],
];
const fail = message => { throw new ApiError(409, 'INVALID_CARD_MOVE', message); };

export function legalCardMoves(hand, table) {
  const singles = hand.map(card => [card]);
  const pairs = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].value === hand[j].value) pairs.push([hand[i], hand[j]]);
    }
  }
  return [...singles, ...pairs].filter(cards => !table || cards.length === table.cards.length && cards[0].value > table.cards[0].value);
}

export function createCards() {
  const deck = attributes.flatMap((attribute, group) => titles[group].map((title, index) => ({
    id: `${group}-${index + 1}`, attribute, title, value: index + 1,
  })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return { id: randomUUID(), hands: [deck.slice(0, 6), deck.slice(6, 12), deck.slice(12)],
    ready: [false, false], startedAt: null, turnAt: null, turn: 0, table: null,
    passes: 0, plays: [0, 0], history: [], done: false, reward: 0, winner: null };
}

function finish(game, winner, now, reason) {
  game.done = true;
  game.winner = winner;
  game.endedAt = now;
  game.reason = reason;
  game.reward = winner === 0 ? 0 : game.plays.every(count => count >= 2) ? 10 : 5;
}

function move(game, actor, ids, now, automatic = false) {
  const hand = game.hands[actor];
  const cards = ids.map(id => hand.find(card => card.id === id));
  if (ids.length) {
    const legal = legalCardMoves(hand, game.table);
    if (new Set(ids).size !== ids.length || cards.some(card => !card) || !legal.some(option => option.length === ids.length && option.every(card => ids.includes(card.id)))) {
      fail('请选择单张或同点数对子，跟牌需同牌型且点数更大');
    }
    game.hands[actor] = hand.filter(card => !ids.includes(card.id));
    game.table = { actor, cards };
    game.passes = 0;
    if (actor) game.plays[actor - 1]++;
  } else {
    if (!game.table) fail('首出时必须出牌');
    game.passes++;
  }
  game.history.push({ actor, cards, automatic, at: now });
  game.history = game.history.slice(-9);
  if (!game.hands[actor].length) return finish(game, actor, now, '手牌已出完');
  if (game.passes === 2) {
    game.turn = game.table.actor;
    game.table = null;
    game.passes = 0;
  } else game.turn = (actor + 1) % 3;
  game.turnAt = now;
}

// A future agent can choose from these same legal moves. All choices use move().
export function chooseWangMove(game) {
  const options = legalCardMoves(game.hands[0], game.table);
  return options.length ? options[randomInt(options.length)].map(card => card.id) : [];
}

export function settleCards(game, now) {
  if (game.done || game.startedAt === null) return false;
  let changed = false;
  // Resolve missed deadlines in order, including when both clients reconnect.
  while (!game.done) {
    const deadline = game.turnAt + (game.turn === 0 ? 1200 : 20000);
    const limit = game.startedAt + 300000;
    if (now >= limit && deadline >= limit) {
      const winner = Math.min(game.hands[1].length, game.hands[2].length) < game.hands[0].length ? 1 : 0;
      finish(game, winner, limit, '五分钟到时，按剩余手牌判定');
      return true;
    }
    if (now < deadline) break;
    const actor = game.turn;
    const cards = actor === 0 ? chooseWangMove(game) : game.table ? [] : [
      [...game.hands[actor]].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))[0].id,
    ];
    move(game, actor, cards, deadline, true);
    changed = true;
  }
  return changed;
}

export function applyCards(game, seat, kind, data, now) {
  if (game.done) fail('牌局已结束');
  if (kind === 'cards_ready') {
    if (game.startedAt !== null) fail('牌局已开始');
    game.ready[seat] = true;
    if (game.ready.every(Boolean)) { game.startedAt = now; game.turnAt = now; }
    return;
  }
  if (kind !== 'cards_play' || game.startedAt === null || game.turn !== seat + 1) fail('请等待你的出牌回合');
  if (!Array.isArray(data.ids) || data.ids.length > 2 || data.ids.some(id => typeof id !== 'string')) fail('出牌格式错误');
  move(game, seat + 1, data.ids, now);
}

export function cardsSnapshot(game, now) {
  return { id: game.id, ready: game.ready, startedAt: game.startedAt, serverNow: now,
    turn: game.turn, turnAt: game.turnAt, table: game.table, passes: game.passes,
    hands: game.hands.slice(1), wangCount: game.hands[0].length, plays: game.plays,
    history: game.history, done: game.done, winner: game.winner, reward: game.reward, reason: game.reason,
    remaining: game.startedAt === null ? 300000 : Math.max(0, 300000 - (now - game.startedAt)) };
}
