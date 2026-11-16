import { fitLandscapeStage } from '/src/games/landscape-stage.js';
import { connectGame } from '/src/games/game-network.js';

const $ = id => document.getElementById(id);
fitLandscapeStage($('landscape-stage'), 844, 390);
const names = ['王站长', '黄慕兰', '林栩'];
let snapshot;
let receivedAt = 0;
let selected = [];
let showingRules = false;
let turnKey;

function cardNode(card, selectable = false) {
  const node = document.createElement(selectable ? 'button' : 'div');
  node.className = 'card';
  node.dataset.attribute = card.attribute;
  node.setAttribute('aria-label', `${card.attribute}${card.value} ${card.title}`);
  for (const [tag, text] of [['b', card.value], ['span', card.attribute], ['em', card.title]]) {
    const part = document.createElement(tag); part.textContent = text; node.append(part);
  }
  if (selectable) {
    node.setAttribute('aria-pressed', String(selected.includes(card.id)));
    node.classList.toggle('selected', selected.includes(card.id));
    node.onclick = () => {
      if (selected.includes(card.id)) selected = selected.filter(id => id !== card.id);
      else if (selected.length < 2) selected.push(card.id);
      else { $('hint').textContent = '一次最多选择两张牌，再次点击可取消。'; return; }
      render();
    };
  }
  return node;
}

function drawHand(id, hand, selectable) {
  $(id).replaceChildren(...[...hand].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id)).map(card => cardNode(card, selectable)));
}

function render() {
  if (!snapshot?.cards) return;
  const game = snapshot.cards;
  const seat = snapshot.me;
  const myTurn = game.startedAt !== null && game.turn === seat + 1 && !game.done;
  const key = `${game.turnAt}.${game.turn}`;
  if (key !== turnKey) { selected = []; turnKey = key; }
  selected = selected.filter(id => game.hands[seat].some(card => card.id === id));
  $('intro').hidden = game.startedAt !== null && !showingRules;
  $('ready').hidden = game.startedAt !== null;
  $('close-rules').hidden = game.startedAt === null;
  $('ready').disabled = game.ready[seat];
  $('ready-status').textContent = game.ready[seat] ? '你已准备，等待同伴准备…' : '双方准备后开始计时。';
  $('my-label').textContent = `${names[seat + 1]} · 你 · 有效出牌 ${game.plays[seat]} 次`;
  $('partner-label').textContent = `${names[2 - seat]} · 同伴 · 有效出牌 ${game.plays[1 - seat]} 次`;
  drawHand('my-hand', game.hands[seat], true);
  drawHand('partner-hand', game.hands[1 - seat], false);
  $('wang-count').textContent = `手牌 ${game.wangCount} 张`;
  $('wang-hand').replaceChildren(...Array.from({ length: game.wangCount }, () => {
    const back = document.createElement('span'); back.className = 'card-back'; return back;
  }));
  const table = game.table;
  $('table-cards').replaceChildren(...(table ? table.cards.map(card => cardNode(card)) : []));
  if (!table) $('table-cards').textContent = '新一轮 · 可出单张或对子';
  const history = game.history.slice(-3);
  $('history').replaceChildren(...history.map(entry => {
    const node = document.createElement('li');
    node.textContent = `${names[entry.actor]}${entry.automatic && entry.actor ? '（超时）' : ''} · ${entry.cards.length ? entry.cards.map(card => `${card.attribute}${card.value}`).join(' + ') : '过牌'}`;
    return node;
  }));
  const lastWang = [...game.history].reverse().find(entry => entry.actor === 0);
  if (lastWang) $('wang-line').textContent = !lastWang.cards.length ? '“这次先听你们的说法。”' : {
    公函: '“一纸公函，就能解释清楚？”', 凭据: '“账上这些疑点，你们如何交代？”', 人脉: '“这件事，我也有上头的人过问。”',
  }[lastWang.cards[0].attribute];
  const cards = selected.map(id => game.hands[seat].find(card => card.id === id));
  const valid = cards.length > 0 && (cards.length === 1 || cards[0].value === cards[1].value)
    && (!table || cards.length === table.cards.length && cards[0].value > table.cards[0].value);
  $('play').disabled = !myTurn || !valid;
  $('pass').disabled = !myTurn || !table;
  $('hint').textContent = myTurn ? selected.length && !valid ? '跟牌须同牌型且更大，对子须同点数。' : '轮到你了，选牌后点击出牌，也可选择过牌。' : '可以查看同伴手牌，商量谁接牌、谁先走完。';
  clock();
}

function clock() {
  if (!snapshot?.cards) return;
  const game = snapshot.cards;
  if (game.startedAt === null) { $('turn').textContent = '双方准备后，王站长先出牌。'; return; }
  const now = game.serverNow + (performance.now() - receivedAt);
  const remaining = Math.max(0, Math.ceil((300000 - (now - game.startedAt)) / 1000));
  const turnRemaining = Math.max(0, Math.ceil((game.turnAt + 20000 - now) / 1000));
  $('clock').textContent = `全局 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  $('turn').textContent = game.turn === 0 ? '王站长正在回应…' : `${names[game.turn]}${game.turn === snapshot.me + 1 ? ' · 你' : ' · 同伴'}出牌 · ${turnRemaining}秒`;
}

const connection = connectGame(value => { snapshot = value; receivedAt = performance.now(); render(); });
$('ready').onclick = () => connection.action('cards_ready');
$('play').onclick = () => connection.action('cards_play', { ids: selected });
$('pass').onclick = () => connection.action('cards_play', { ids: [] });
$('rules-button').onclick = () => { showingRules = true; render(); };
$('close-rules').onclick = () => { showingRules = false; render(); };
setInterval(clock, 200);
