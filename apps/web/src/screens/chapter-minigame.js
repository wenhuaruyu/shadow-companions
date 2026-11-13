import { button, modal } from '../components/dom.js';
import { suspects } from '../games/investigation-content.js';
import { attemptElapsed } from '../state/snapshot.js';
import { positions, guards, lamps } from '../games/back-alley.js';

let active = null;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

export function renderChapterMinigame(context) {
  const panel = document.querySelector('#panel');
  panel.dataset.attempt = context.snapshot.attempt.id;
  active = { ...context, busy: false, lastMove: -Infinity, gesture: null, held: null, view: null };
  panel.insertAdjacentHTML('beforeend', '<section id="chapter-game"><p id="chapter-timer" role="timer"></p><div id="chapter-controls"></div><canvas id="chapter-board" tabindex="0" aria-label="小游戏地图" hidden></canvas><p id="chapter-feedback" role="status"></p></section>');
  const canvas = document.querySelector('#chapter-board');
  canvas.style.width = '100%';
  canvas.style.maxWidth = '650px';
  canvas.style.touchAction = 'none';
  canvas.onpointerdown = event => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    active.gesture = { x: event.clientX, y: event.clientY, from: gridPoint(event), to: gridPoint(event) };
  };
  canvas.onpointermove = event => {
    if (!active.gesture) return;
    active.gesture.to = lineEnd(active.gesture.from, gridPoint(event));
    if (active.snapshot.cooperative?.role === 'int') return;
    const dx = event.clientX - active.gesture.x, dy = event.clientY - active.gesture.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 14) {
      active.held = Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up';
    }
  };
  canvas.onpointerup = event => {
    const gesture = active.gesture;
    active.gesture = null;
    const direction = active.held;
    active.held = null;
    if (!gesture) return;
    if (active.snapshot.cooperative?.role === 'int') {
      send('coop_light', { from: gesture.from, to: lineEnd(gesture.from, gridPoint(event)) });
    } else if (direction) move(direction);
    else {
      const target = gridPoint(event);
      const position = active.snapshot.cooperative?.position || active.snapshot.attempt.run.position;
      const dx = target[0] - position[0], dy = target[1] - position[1];
      if (Math.abs(dx) + Math.abs(dy) === 1) move(dx ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    }
  };
  canvas.onpointercancel = canvas.onlostpointercapture = () => { if (active) { active.held = null; active.gesture = null; } };
  canvas.onkeydown = event => {
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
    if (direction) { event.preventDefault(); move(direction); }
  };
  updateChapterMinigame(context.snapshot);
}

async function send(kind, data = {}) {
  if (!active || active.busy) return;
  const context = active;
  context.busy = true;
  try { await context.action(kind, data); }
  finally { context.busy = false; }
}
function move(direction) {
  if (!active || active.busy || active.snapshot.attempt.done || performance.now() - active.lastMove < 225) return;
  if (active.snapshot.cooperative && active.snapshot.cooperative.role !== 'str') return;
  active.lastMove = performance.now();
  send(active.snapshot.cooperative ? 'coop_move' : 'alley_move', { direction });
}
function dimensions() {
  const snapshot = active.snapshot;
  return snapshot.cooperative ? [snapshot.cooperative.width, snapshot.cooperative.height] : [13, 9];
}
function gridPoint(event) {
  const canvas = document.querySelector('#chapter-board');
  const rect = canvas.getBoundingClientRect();
  const [width, height] = dimensions();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const contained = getComputedStyle(canvas).objectFit === 'contain';
  const imageWidth = contained ? canvas.width * scale : rect.width;
  const imageHeight = contained ? canvas.height * scale : rect.height;
  const left = rect.left + (rect.width - imageWidth) / 2;
  const top = rect.top + (rect.height - imageHeight) / 2;
  return [Math.max(0, Math.min(width - 1, Math.floor((event.clientX - left) / imageWidth * width))),
    Math.max(0, Math.min(height - 1, Math.floor((event.clientY - top) / imageHeight * height)))];
}
function lineEnd(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  return Math.abs(dx) >= Math.abs(dy) ? [from[0] + Math.sign(dx) * Math.min(4, Math.abs(dx)), from[1]]
    : [from[0], from[1] + Math.sign(dy) * Math.min(4, Math.abs(dy))];
}

function intelligence(snapshot, controls) {
  if (active.view !== 'int') {
    active.view = 'int';
    controls.innerHTML = '<p>点击人物查看聊天与证据，点击“是她／是他”立即判断。</p>';
    for (const person of suspects) {
      const card = document.createElement('section');
      card.className = 'question';
      card.innerHTML = `<h3>${person.name} · ${person.role}</h3>`;
      card.append(button('聊天与证据', () => {
        modal(person.dialogue.map(line => `${line.speaker}　${line.text}`).join('\n\n') + '\n\n' + person.evidence.map(item => `${item.title}\n${item.text}`).join('\n\n'));
      }));
      const judge = button(person.id === 'su' ? '是她' : '是他', () => send('judge', { suspectId: person.id }));
      judge.dataset.suspect = person.id;
      card.append(judge);
      controls.append(card);
    }
  }
  document.querySelectorAll('[data-suspect]').forEach(element => { element.disabled = snapshot.attempt.guesses.includes(element.dataset.suspect); });
  document.querySelector('#chapter-feedback').textContent = `剩余判断 ${3 - snapshot.attempt.guesses.length} 次${snapshot.attempt.guesses.length ? '，请重新核对聊天与证据。' : ''}`;
}

function cooperativeControls(snapshot, controls) {
  const coop = snapshot.cooperative;
  const key = JSON.stringify([coop.phase, coop.players]);
  if (active.view === key) return;
  active.view = key;
  controls.replaceChildren();
  if (coop.phase === 'coop-lobby') {
    controls.innerHTML = '<p>第二章双人协作。引路者看全图，画五格直线照明；营救者移动寻找五人。照明冷却5秒、持续20秒，双方准备后开始180秒计时。</p>';
    for (const role of ['int', 'str']) {
      const control = button(role === 'int' ? '选择引路者 · 智力' : '选择营救者 · 武力', () => send('coop_role', { role }));
      control.disabled = coop.players[coop.me].ready || coop.players.some((player, index) => index !== coop.me && player.role === role);
      controls.append(control);
    }
    const mine = coop.players[coop.me];
    controls.append(button(mine.ready ? '取消准备' : '准备开始', () => send('coop_ready', { ready: !mine.ready })));
    controls.lastChild.disabled = !mine.role;
    const current = document.createElement('p');
    current.textContent = coop.players.map((player, index) => `${index === coop.me ? '你' : '同伴'}：${player.role === 'int' ? '引路者' : player.role === 'str' ? '营救者' : '待选择'}，${player.ready ? '已准备' : '未准备'}`).join(' / ');
    controls.append(current);
  } else controls.innerHTML = `<p>${coop.role === 'int' ? '拖动画横向或纵向直线，松手照明，每笔最多5格。' : '滑动或点击相邻格移动，长按拖动可连续走。走到出口即自动结算。'}</p>`;
}

export function updateChapterMinigame(snapshot) {
  if (!active || active.snapshot.attempt.id !== snapshot.attempt?.id || !document.querySelector('#chapter-game')) return;
  active.snapshot = snapshot;
  const timer = document.querySelector('#chapter-timer');
  timer.textContent = `${Math.max(0, Math.ceil((snapshot.attempt.duration - attemptElapsed(snapshot)) / 1000))} 秒`;
  const controls = document.querySelector('#chapter-controls');
  if (snapshot.attempt.type === 'int') return intelligence(snapshot, controls);
  const canvas = document.querySelector('#chapter-board');
  const coop = snapshot.cooperative;
  if (coop) cooperativeControls(snapshot, controls);
  else if (active.view !== 'str') {
    active.view = 'str';
    controls.innerHTML = '<p>第一章武力游戏。避开守卫和灯光，依次经过两个掩护点，再抵达接应点。</p>';
  }
  canvas.hidden = coop ? coop.phase !== 'coop-playing' : false;
  if (canvas.hidden) return;
  const [width, height] = dimensions();
  if (canvas.width !== width * 40 || canvas.height !== height * 40) { canvas.width = width * 40; canvas.height = height * 40; }
  const ctx = canvas.getContext('2d');
  const grid = coop ? coop.grid : snapshot.alley.map;
  const now = coop ? coop.serverNow + Math.max(0, performance.now() - snapshot.receivedAt) : 0;
  const lit = (x, y) => coop?.lights.some(light => light.expiresAt > now && x >= Math.min(light.from[0], light.to[0]) && x <= Math.max(light.from[0], light.to[0]) && y >= Math.min(light.from[1], light.to[1]) && y <= Math.max(light.from[1], light.to[1]));
  const position = coop ? coop.position : snapshot.attempt.run.position;
  const visible = (x, y) => !coop || coop.role === 'int' || same(position, [x, y]) || lit(x, y);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    ctx.fillStyle = !visible(x, y) || grid[y][x] === '?' ? '#090b0e' : grid[y][x] === '#' ? '#343b43' : lit(x, y) ? '#fffdf0' : '#efdbb5';
    ctx.fillRect(x * 40, y * 40, 40, 40);
  }
  ctx.strokeStyle = '#343b43'; ctx.lineWidth = 4;
  for (const wall of coop?.walls || []) { ctx.beginPath(); ctx.moveTo(wall.from[0] * 40, wall.from[1] * 40); ctx.lineTo(wall.to[0] * 40, wall.to[1] * 40); ctx.stroke(); }
  const marker = (point, color, text, circle = false) => {
    if (!visible(...point)) return;
    ctx.fillStyle = color;
    if (circle) { ctx.beginPath(); ctx.arc(point[0] * 40 + 20, point[1] * 40 + 20, 12, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(point[0] * 40 + 8, point[1] * 40 + 8, 24, 24);
    if (text) { ctx.fillStyle = '#171716'; ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.fillText(text, point[0] * 40 + 20, point[1] * 40 + 25); }
  };
  if (coop) {
    for (const person of coop.people) marker(person.position, person.color, String(person.id + 1), true);
    if (coop.exit) marker(coop.exit, '#60b88c', '出');
    const cooldown = Math.max(0, coop.cooldown - (performance.now() - snapshot.receivedAt));
    document.querySelector('#chapter-feedback').textContent = `找到 ${coop.found.length}/5 人${coop.role === 'int' ? ` · 照明冷却 ${Math.ceil(cooldown / 1000)} 秒` : ''}`;
  } else {
    const run = snapshot.attempt.run;
    snapshot.alley.checkpoints.forEach((point, index) => marker(point, run.checkpoint > index ? '#60b88c' : '#eab84c', String(index + 1)));
    marker(snapshot.alley.exit, '#60b88c', '出');
    positions(guards, run.tick, 3).forEach(point => marker(point, '#e96969'));
    positions(lamps, run.tick, 9).forEach(point => marker(point, '#fffdf0'));
    document.querySelector('#chapter-feedback').textContent = `掩护点 ${Math.min(2, run.checkpoint)}/2 · 被发现 ${run.caught} 次`;
  }
  // A small pixel figure stays inside the road cell.
  const [x, y] = position;
  ctx.fillStyle = '#f0ba87'; ctx.fillRect(x * 40 + 15, y * 40 + 8, 10, 10);
  ctx.fillStyle = '#2574bd'; ctx.fillRect(x * 40 + 12, y * 40 + 18, 16, 12);
  ctx.fillStyle = '#171a20'; ctx.fillRect(x * 40 + 12, y * 40 + 30, 5, 5); ctx.fillRect(x * 40 + 23, y * 40 + 30, 5, 5);
  if (active.gesture && coop?.role === 'int') {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(active.gesture.from[0] * 40 + 20, active.gesture.from[1] * 40 + 20); ctx.lineTo(active.gesture.to[0] * 40 + 20, active.gesture.to[1] * 40 + 20); ctx.stroke();
  }
  if (active.held) move(active.held);
}
