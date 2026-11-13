import { newRecoverySecret, newRequestId, readStored } from '../state/storage.js';
import { escapeHtml } from '../components/dom.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#maze');
const ctx = canvas.getContext('2d');
let room = new URLSearchParams(location.search).get('room');
let session = room ? readStored(sessionStorage, `anxian.coop.session.${room}`) : null;
let snapshot = null;
let receivedAt = 0;
let busy = false;
let polling = false;
let lobbyView = '';
let drawing = null;
let hold = null;
let lastMove = -Infinity;
let pending = session ? readStored(sessionStorage, `anxian.coop.pending.${session.id}`) : null;
const notice = text => { $('#notice').textContent = text; };
const label = role => role === 'int' ? '引路者 · 智力' : role === 'str' ? '营救者 · 武力' : '尚未选择分工';

async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api/coop/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Contract-Version': '2', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.message || '操作失败');
      error.code = result.code;
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function accept(next) {
  if (snapshot && next.version < snapshot.version) return;
  const previousPhase = snapshot?.phase;
  snapshot = next;
  receivedAt = performance.now();
  render();
  if (previousPhase !== snapshot.phase && snapshot.phase !== 'coop-lobby') window.scrollTo(0, 0);
}

async function enter(joining) {
  if (busy) return;
  busy = true;
  try {
    const target = joining ? $('#room-code').value.trim() : '';
    if (joining && !/^[0-9a-f-]{36}$/.test(target)) throw new Error('请输入邀请链接中的完整房间编号');
    const key = `anxian.coop.entry.${target || 'create'}`;
    const body = readStored(sessionStorage, key) || { requestId: newRequestId(), recoverySecret: newRecoverySecret(), ...(joining ? { room: target } : { contentVersion: 'mvp-two-sites-1' }) };
    sessionStorage.setItem(key, JSON.stringify(body));
    const result = await request(joining ? 'join' : 'create', body);
    session = { id: result.id, token: result.token };
    room = result.id;
    sessionStorage.setItem(`anxian.coop.session.${room}`, JSON.stringify(session));
    sessionStorage.removeItem(key);
    history.replaceState(null, '', `${location.pathname}?room=${room}`);
    accept(result.snapshot);
    notice('');
  } catch (error) { notice(error.message); }
  finally { busy = false; }
}

async function send(kind, data = {}) {
  if (busy || !session || !snapshot) return;
  busy = true;
  pending ||= { room: session.id, requestId: newRequestId(), kind, data };
  const key = `anxian.coop.pending.${session.id}`;
  sessionStorage.setItem(key, JSON.stringify(pending));
  try {
    const result = await request('action', pending);
    pending = null;
    sessionStorage.removeItem(key);
    accept(result.snapshot);
    notice('');
  } catch (error) {
    if (error.code && error.code !== 'TEMPORARILY_UNAVAILABLE') {
      pending = null;
      sessionStorage.removeItem(key);
    }
    if (!['MOVE_COOLDOWN', 'LIGHT_COOLDOWN'].includes(error.code)) notice(error.message || '连接中断，请重试原操作');
  } finally {
    busy = false;
    $('#retry').hidden = !pending;
  }
}
$('#retry').onclick = () => send();

function render() {
  if (!snapshot) {
    $('#lobby').innerHTML = `<h2>两个人，一条撤离路线</h2><p>引路者掌握完整地图，每 5 秒可照亮一条最多 5 格的直线，照明持续 20 秒。营救者在黑暗中寻找五个人，并在 180 秒内选择撤离。</p><p>只通过照明引路，请双方约定不使用语音或文字报路。</p><div class="actions"><button id="create" class="primary">创建协作房间</button></div><label for="room-code">同伴的房间编号</label><input id="room-code" autocomplete="off" value="${escapeHtml(room || '')}"><div class="actions"><button id="join">加入协作房间</button></div>`;
    $('#create').onclick = () => enter(false);
    $('#join').onclick = () => enter(true);
    return;
  }
  const lobby = snapshot.phase === 'coop-lobby';
  $('#lobby').hidden = !lobby;
  $('#play').hidden = lobby || snapshot.done;
  $('#result').hidden = !snapshot.done;
  $('#status').textContent = snapshot.done ? '协作结束' : lobby ? '等待双方准备' : '行动进行中';
  if (lobby) {
    const fingerprint = JSON.stringify(snapshot.players);
    if (fingerprint === lobbyView) return;
    lobbyView = fingerprint;
    const mine = snapshot.players[snapshot.me];
    const invite = `${location.origin}${location.pathname}?room=${snapshot.id}`;
    $('#lobby').innerHTML = `<h2>选择你的分工</h2>
      <section aria-label="游戏说明">
        <h3>游戏说明</h3>
        <p>两人协作，在 <strong>180 秒</strong>内寻找迷宫中的五名人员，并尝试到达绿色出口撤离。双方分别选择一种分工，均点击“准备开始”后共同计时。</p>
        <p>找到人员立即计入人数，可以提前撤离。找到 0～5 人，分别获得 0、1、2、4、6、8 分，成功撤离额外加 2 分，每人最高 10 分。超时保留已找到人员的奖励。</p>
        <p>合作时只通过照明传递路线，请双方约定不使用语音或文字报路。刷新或短暂断线期间，倒计时继续。</p>
      </section>
      <section aria-label="分工介绍">
        <h3>每个分工做什么</h3>
        <div class="seats">
          <div class="seat"><b>引路者 · 获得智力奖励</b>
            <p>你能看见完整迷宫、五名人员、出口及营救者的位置，负责观察路线，用照明引导同伴。</p>
            <p>在地图上按住并拖动，松手画出一条横向或纵向直线，每笔最多照亮 5 格，可跨墙。每 5 秒可画一笔，每笔照明持续 20 秒。开局即可画第一笔。</p>
          </div>
          <div class="seat"><b>营救者 · 获得武力奖励</b>
            <p>你负责操纵像素小人寻找人员。通过滑动、点击相邻格或长按方向键移动，接触彩色圆圈即可找到对应人员。</p>
            <p>你只看见脚下当前格及同伴照亮的区域，可以尝试走入黑格，遇墙停留。走到绿色出口即自动撤离，结束双方行动并结算奖励。</p>
          </div>
        </div>
      </section>
      <h3>邀请同伴并选择分工</h3>
      <p>将邀请链接发给同伴，两人分别选择引路者和营救者。</p><a id="invite-link" href="${invite}">${invite}</a><button id="copy">复制邀请链接</button><div class="seats">${snapshot.players.map((player, index) => `<div class="seat"><b>${index === snapshot.me ? '你' : '同伴'}</b>${label(player.role)} · ${player.ready ? '已准备' : '未准备'}</div>`).join('')}</div><div class="actions">${['int', 'str'].map(role => `<button data-role="${role}" ${mine.ready || snapshot.players.some((p, i) => i !== snapshot.me && p.role === role) ? 'disabled' : ''} class="${mine.role === role ? 'primary' : ''}">${label(role)}</button>`).join('')}</div><button id="ready" class="primary" ${!mine.role ? 'disabled' : ''}>${mine.ready ? '取消准备' : '准备开始'}</button>`;
    $('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(invite); notice('邀请链接已复制'); }
      catch { notice('请长按上方邀请链接复制'); }
    };
    document.querySelectorAll('[data-role]').forEach(button => { button.onclick = () => send('role', { role: button.dataset.role }); });
    $('#ready').onclick = () => send('ready', { ready: !mine.ready });
    return;
  }
  if (snapshot.done) {
    hold = null;
    $('#result').innerHTML = `<h2>${snapshot.escaped ? '成功撤离' : '行动时间结束'}</h2><p>找到 ${snapshot.found.length} / 5 人${snapshot.escaped ? '，获得撤离奖励 +2' : ''}</p><p class="score">+${snapshot.reward}</p><p>${snapshot.players.map(player => `${label(player.role)} +${snapshot.reward}`).join('　/　')}</p><p class="hint">本次奖励已由服务端统一结算。</p><button id="new-game">新建一轮协作</button>`;
    $('#new-game').onclick = () => {
      session = null; snapshot = null; pending = null; room = null; lobbyView = '';
      history.replaceState(null, '', location.pathname);
      $('#result').hidden = true; $('#lobby').hidden = false; render();
    };
    return;
  }
  if (canvas.width !== snapshot.width * 50 || canvas.height !== snapshot.height * 50) {
    canvas.width = snapshot.width * 50;
    canvas.height = snapshot.height * 50;
  }
  $('#role').textContent = label(snapshot.role);
  $('#found').textContent = `已找到 ${snapshot.found.length} / 5 人`;
  if ($('#controls').dataset.role !== snapshot.role) {
    $('#controls').dataset.role = snapshot.role;
    $('#controls').innerHTML = snapshot.role === 'int'
      ? '<p id="light-status"></p><p class="hint">拖动画直线，松手照亮 · 横向或纵向最多 5 格 · 可跨墙</p>'
      : '<div class="pad"><button data-dir="up" aria-label="向上">↑</button><button data-dir="left" aria-label="向左">←</button><button data-dir="down" aria-label="向下">↓</button><button data-dir="right" aria-label="向右">→</button></div><p class="hint">滑动、点相邻格或长按方向键移动 · 遇墙停留</p><p class="hint">走到绿色出口即自动撤离并结算。</p>';
    document.querySelectorAll('[data-dir]').forEach(button => {
      button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); hold = button.dataset.dir; move(hold); };
      button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => { hold = null; };
    });
  }
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function move(direction) {
  if (performance.now() - lastMove < 220 || busy || pending) return;
  lastMove = performance.now();
  send('move', { direction });
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return [Math.max(0, Math.min(snapshot.width - 1, Math.floor((event.clientX - rect.left) / rect.width * snapshot.width))), Math.max(0, Math.min(snapshot.height - 1, Math.floor((event.clientY - rect.top) / rect.height * snapshot.height)))];
}
function endpoint(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  return Math.abs(dx) >= Math.abs(dy) ? [from[0] + Math.sign(dx) * Math.min(4, Math.abs(dx)), from[1]] : [from[0], from[1] + Math.sign(dy) * Math.min(4, Math.abs(dy))];
}
canvas.onpointerdown = event => {
  if (!snapshot || snapshot.done || snapshot.phase !== 'coop-playing') return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  const from = point(event);
  drawing = { from, to: from, x: event.clientX, y: event.clientY };
};
canvas.onpointermove = event => {
  if (drawing && snapshot?.role === 'int') drawing.to = endpoint(drawing.from, point(event));
};
canvas.onpointerup = event => {
  if (!drawing) return;
  const gesture = drawing; drawing = null;
  if (snapshot.role === 'int') {
    if (snapshot.cooldown - (performance.now() - receivedAt) > 0) return;
    send('light', { from: gesture.from, to: endpoint(gesture.from, point(event)) });
  } else {
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 14) move(Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    else {
      const target = point(event), delta = [target[0] - snapshot.position[0], target[1] - snapshot.position[1]];
      if (Math.abs(delta[0]) + Math.abs(delta[1]) === 1) move(delta[0] ? delta[0] > 0 ? 'right' : 'left' : delta[1] > 0 ? 'down' : 'up');
    }
  }
};
canvas.onpointercancel = () => { drawing = null; };
window.addEventListener('blur', () => { hold = null; drawing = null; });

// Ten by twelve pixels, drawn at 3x, leaves a margin inside a 50px road cell.
const playerSprite = [
  '...HHHH...',
  '..HHHHHH..',
  '..HSSSSH..',
  '...SKKS...',
  '...SSSS...',
  '..BBBBBB..',
  '.SBBBBBBS.',
  '.SBBBBBBS.',
  '...BBBB...',
  '...PPPP...',
  '...P..P...',
  '..KK..KK..',
];
const playerColors = { H: '#282326', S: '#f0ba87', K: '#171a20', B: '#2574bd', P: '#25425f' };
function drawPlayer([x, y]) {
  ctx.fillStyle = '#00000035';
  ctx.fillRect(x * 50 + 11, y * 50 + 41, 28, 4);
  for (let row = 0; row < playerSprite.length; row++) {
    for (let column = 0; column < playerSprite[row].length; column++) {
      const color = playerColors[playerSprite[row][column]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * 50 + 10 + column * 3, y * 50 + 6 + row * 3, 3, 3);
    }
  }
}

function draw() {
  if (!snapshot?.grid || snapshot.done) return;
  const now = snapshot.serverNow + performance.now() - receivedAt;
  const remaining = Math.max(0, snapshot.remaining - (performance.now() - receivedAt));
  $('#timer').textContent = `${Math.ceil(remaining / 1000)} 秒`;
  const cooldown = Math.max(0, snapshot.cooldown - (performance.now() - receivedAt));
  if ($('#light-status')) $('#light-status').textContent = cooldown > 0 ? `照明冷却 ${Math.ceil(cooldown / 1000)} 秒` : '照明已就绪';
  const lit = (x, y) => snapshot.lights.some(light => light.expiresAt > now && x >= Math.min(light.from[0], light.to[0]) && x <= Math.max(light.from[0], light.to[0]) && y >= Math.min(light.from[1], light.to[1]) && y <= Math.max(light.from[1], light.to[1]));
  const visible = (x, y) => snapshot.role === 'int' || same([x, y], snapshot.position) || lit(x, y);
  ctx.lineWidth = 1;
  for (let y = 0; y < snapshot.height; y++) {
    for (let x = 0; x < snapshot.width; x++) {
      const cell = snapshot.grid[y][x];
      ctx.fillStyle = !visible(x, y) || cell === '?' ? '#090b0e' : cell === '#' ? '#343b43' : lit(x, y) ? '#fffdf0' : '#efdbb5';
      ctx.fillRect(x * 50, y * 50, 50, 50);
      if (visible(x, y) && cell !== '?') { ctx.strokeStyle = cell === '#' ? '#171e25' : '#af946955'; ctx.strokeRect(x * 50, y * 50, 50, 50); }
    }
  }
  ctx.strokeStyle = '#343b43';
  ctx.lineWidth = 5;
  ctx.lineCap = 'square';
  for (const wall of snapshot.walls) {
    ctx.beginPath();
    ctx.moveTo(wall.from[0] * 50, wall.from[1] * 50);
    ctx.lineTo(wall.to[0] * 50, wall.to[1] * 50);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  if (snapshot.exit && visible(...snapshot.exit)) {
    ctx.fillStyle = '#3f835d';ctx.fillRect(snapshot.exit[0] * 50 + 6, snapshot.exit[1] * 50 + 6, 38, 38);
    ctx.fillStyle = '#fff';ctx.font = '18px serif';ctx.textAlign = 'center';ctx.fillText('出口', snapshot.exit[0] * 50 + 25, snapshot.exit[1] * 50 + 31);
  }
  for (const person of snapshot.people) {
    if (!visible(...person.position)) continue;
    ctx.beginPath();ctx.arc(person.position[0] * 50 + 25, person.position[1] * 50 + 25, 14, 0, Math.PI * 2);ctx.fillStyle = person.color;ctx.fill();
    ctx.fillStyle = '#171716';ctx.font = 'bold 16px serif';ctx.fillText(String(person.id + 1), person.position[0] * 50 + 25, person.position[1] * 50 + 31);
  }
  drawPlayer(snapshot.position);
  if (drawing && snapshot.role === 'int') {
    ctx.strokeStyle = cooldown > 0 ? '#d85c4b' : '#fff';ctx.lineWidth = 7;ctx.beginPath();ctx.moveTo(drawing.from[0] * 50 + 25, drawing.from[1] * 50 + 25);ctx.lineTo(drawing.to[0] * 50 + 25, drawing.to[1] * 50 + 25);ctx.stroke();
  }
}
async function poll() {
  if (!session || polling || document.hidden) return;
  polling = true;
  try { accept((await request(`state?room=${session.id}`)).snapshot); }
  catch (error) { notice(error.message || '连接中断，正在尝试恢复'); }
  finally { polling = false; }
}
render();
if (session) poll();
setInterval(poll, 500);
setInterval(() => { draw(); if (hold) move(hold); }, 50);
document.addEventListener('visibilitychange', () => { hold = null; drawing = null; if (!document.hidden) poll(); });
