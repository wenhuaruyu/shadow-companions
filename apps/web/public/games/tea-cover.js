import { fitLandscapeStage } from '/src/games/landscape-stage.js';
import { phases, positions, enemyTotal, shotInterval, directions, buildSchedule, buildDodges, coverReward } from '/src/games/tea-cover-rules.js';
import { connectQueuedGame } from '/src/games/game-network.js';
let network = null;
const $ = (id) => document.getElementById(id);
fitLandscapeStage($('landscape-stage'));
const duration = 120000;
let gesture = null;
let suppressClickUntil = 0;
let state;
let frame;
let effects = new Set();
function reset() {
  cancelAnimationFrame(frame);
  for (const timeout of effects) clearTimeout(timeout);
  effects.clear();
  state = { active: false, started: 0, hits: 0, dodges: 0, wounds: 0, dodge: null, nextDodgeAt: 8000 + Math.random() * 4000, friendlyHits: 0, shots: 0, lastShot: -Infinity, empty: 0, missed: 0, next: 0, targets: new Map(), phase: -1, schedule: buildSchedule() };
  $('targets').replaceChildren();
  $('dodge-cue').hidden = true;
  $('field').classList.remove('evaded', 'wounded');
  gesture = null;
  suppressClickUntil = 0;
  $('field').querySelectorAll('.impact').forEach((node) => node.remove());
  $('intro').hidden = false;
  $('result').hidden = true;
  $('phase-label').textContent = '等待行动';
  $('story').textContent = '同伴正在分析路线，你负责掩护转移队伍。';
  $('progress').style.width = '0%';
  $('clock').textContent = '02:00';
  $('clock').classList.remove('urgent');
  notice('等待队伍进入茶林');
  $('remaining').textContent = '三段掩护 / 全程 120 秒';
  updateStats();
}
function notice(text, type = '') {
  $('notice').textContent = text;
  $('notice').className = `notice ${type}`;
}
function updateStats() {
  $('hits').textContent = `${state.hits} / ${enemyTotal}`;
  $('friendly-hits').textContent = state.friendlyHits;
  $('dodge-stats').textContent = `${state.dodges} / ${state.wounds}`;
  $('statistics').textContent = `射击 ${state.shots} · 空枪 ${state.empty} · 漏击 ${state.missed}`;
}
function removeTarget(event, missed = false) {
  const target = state.targets.get(event.id);
  if (!target) return;
  if (missed && !event.friendly) state.missed += 1;
  target.button.remove();
  state.targets.delete(event.id);
}

function showTarget(event, elapsed) {
  const button = document.createElement('button');
  const [x, y] = positions[event.position];
  button.className = `target${event.friendly ? ' friendly' : ''}`;
  button.style.left = `${x}%`;
  button.style.top = `${y}%`;
  button.style.setProperty('--lifetime', `${event.at + event.exposure - elapsed}ms`);
  button.setAttribute('aria-label', event.friendly ? '友方接应队员，请勿射击' : '敌方目标，点击射击');
  button.innerHTML = `<span class="target-label">${event.friendly ? '接应' : '敌方'}</span><span class="person" aria-hidden="true"><i class="head"></i><i class="helmet"></i><i class="body"></i><i class="armband"></i><i class="weapon"></i></span><span class="lifetime" aria-hidden="true"><i></i></span>`;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.active || !canFire()) return;
    const now = Date.now() - state.started;
    if (now >= duration) { finish(); return; }
    if (now >= event.at + event.exposure || !state.targets.has(event.id)) {
      removeTarget(event, true);
      fire(e, '空枪');
      state.empty += 1;
      notice('目标已离开 · 空枪扣除 0.5 个有效命中', 'bad');
    } else {
      fire(e, event.friendly ? '误击' : '命中', event.id);
      if (event.friendly) {
        state.friendlyHits += 1;
        notice('误击接应队员 · 扣除 3 个有效命中', 'bad');
      } else {
        state.hits += 1;
        notice('敌方命中 · 继续掩护队伍', 'good');
      }
      showBulletHole(button, e);
      removeTarget(event);
    }
    updateStats();
  });
  state.targets.set(event.id, { event, button });
  $('targets').append(button);
}
function showBulletHole(button, shot) {
  const rect = button.getBoundingClientRect();
  const x = shot.detail === 0 ? 50 : Math.max(4, Math.min(96, (shot.clientX - rect.left) / rect.width * 100));
  const y = shot.detail === 0 ? 55 : Math.max(4, Math.min(96, (shot.clientY - rect.top) / rect.height * 100));
  const remnant = button.cloneNode(true);
  remnant.classList.add('hit-remnant');
  remnant.disabled = true;
  remnant.tabIndex = -1;
  remnant.setAttribute('aria-hidden', 'true');
  for (const className of ['bullet-hole', 'bullet-spark']) {
    const mark = document.createElement('i');
    mark.className = className;
    mark.style.left = `${x}%`;
    mark.style.top = `${y}%`;
    remnant.append(mark);
  }
  $('targets').append(remnant);
  const timeout = setTimeout(() => { remnant.remove(); effects.delete(timeout); }, 500);
  effects.add(timeout);
}
function canFire() {
  return Date.now() - state.lastShot >= shotInterval;
}
function fire(event, text, targetId = null) {
  if (network) network.action('tea_shot', { targetId, elapsed: Date.now() - state.started });
  state.lastShot = Date.now();
  state.shots += 1;
  $('shot-flash').classList.remove('flash');
  void $('shot-flash').offsetWidth;
  $('shot-flash').classList.add('flash');
  const rect = $('field').getBoundingClientRect();
  const impact = document.createElement('span');
  impact.className = 'impact';
  impact.textContent = text === '命中' ? '✦' : '×';
  impact.style.left = `${event.clientX - rect.left}px`;
  impact.style.top = `${event.clientY - rect.top}px`;
  $('field').append(impact);
  const timeout = setTimeout(() => { impact.remove(); effects.delete(timeout); }, 400);
  effects.add(timeout);
}
$('field').addEventListener('click', (event) => {
  if (!state.active || !canFire()) return;
  if (Date.now() - state.started >= duration) { finish(); return; }
  fire(event, '空枪');
  state.empty += 1;
  notice('空枪 · 扣除 0.5 个有效命中', 'bad');
  updateStats();
});
function tick() {
  if (!state.active) return;
  const elapsed = Math.min(duration, Date.now() - state.started);
  for (const { event } of state.targets.values()) {
    if (elapsed >= event.at + event.exposure) removeTarget(event, true);
  }
  if (elapsed >= duration) { finish(); return; }
  if (state.dodge && elapsed >= state.dodge.deadline) resolveDodge(false);
  if (network && !state.dodge) {
    const cue = state.dodgeSchedule?.find(item => elapsed >= item.at && elapsed < item.at + item.windowMs && !state.handledDodges.has(item.id));
    if (cue) {
      state.dodge = { ...cue, deadline: cue.at + cue.windowMs };
      $('dodge-arrow').textContent = directions[cue.direction].arrow;
      $('dodge-direction').textContent = directions[cue.direction].text + ' / 方向键';
      $('dodge-cue').hidden = false;
    }
  }
  if (!network && !state.dodge && elapsed >= state.nextDodgeAt && elapsed < duration - 2500) {
    const keys = Object.keys(directions);
    const direction = keys[Math.floor(Math.random() * keys.length)];
    const windowMs = [1800, 1500, 1200][Math.floor(elapsed / 40000)];
    state.dodge = { direction, deadline: elapsed + windowMs, windowMs };
    $('dodge-arrow').textContent = directions[direction].arrow;
    $('dodge-direction').textContent = directions[direction].text + ' / 方向键';
    $('dodge-cue').hidden = false;
  }
  if (state.dodge) $('dodge-time').style.transform = `scaleX(${Math.max(0, (state.dodge.deadline - elapsed) / state.dodge.windowMs)})`;
  const phase = Math.floor(elapsed / 40000);
  if (state.phase !== phase) {
    state.phase = phase;
    $('phase-label').textContent = `${phases[phase].name} · ${phase + 1} / 3`;
    $('story').textContent = phases[phase].story;
    notice(phases[phase].name + ' · 保持警戒');
  }
  while (state.next < state.schedule.length && state.schedule[state.next].at <= elapsed) {
    const event = state.schedule[state.next++];
    if (state.hitIds?.has(event.id)) continue;
    if (elapsed < event.at + event.exposure) showTarget(event, elapsed);
    else if (!event.friendly) state.missed += 1;
  }
  const seconds = Math.ceil((duration - elapsed) / 1000);
  $('clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('urgent', seconds <= 20);
  $('progress').style.width = `${elapsed / duration * 100}%`;
  $('remaining').textContent = `已通过 ${Math.floor(elapsed / duration * 100)}% · 继续掩护`;
  updateStats();
  frame = requestAnimationFrame(tick);
}
function finish() {
  if (!state.active) return;
  state.active = false;
  state.dodge = null;
  gesture = null;
  $('dodge-cue').hidden = true;
  cancelAnimationFrame(frame);
  for (const { event } of state.targets.values()) removeTarget(event);
  state.missed = enemyTotal - state.hits;
  const effective = Math.max(0, state.hits - state.friendlyHits * 3 - state.empty * .5 - state.wounds * 3);
  const rate = effective / enemyTotal;
  const reward = rate >= .8 ? 10 : rate >= .4 ? 5 : 0;
  $('clock').textContent = '00:00';
  $('progress').style.width = '100%';
  $('remaining').textContent = '掩护结束 · 120 秒';
  $('result-title').textContent = reward ? '队伍进入密林' : '掩护阵地失守';
  $('result-story').textContent = reward ? '最后一名接应队员退入茶林，你收起短枪，沿着约定的小路追上队伍。前方传来同伴的呼唤，情报与掩护终于接上了这一程。' : '追兵穿过岔口，迫使队伍停止转移。你与接应队员退回茶园，等待重新组织护送。';
  $('reward').textContent = `武力 +${reward}`;
  $('final-hits').textContent = `${state.hits} / ${enemyTotal}`;
  $('final-friendly').textContent = state.friendlyHits;
  $('final-rate').textContent = `${(Math.floor(rate * 1000) / 10).toFixed(1)}%`;
  $('final-detail').textContent = `闪避成功 ${state.dodges} 次，受伤 ${state.wounds} 次。有效命中 ${effective}，漏击 ${state.missed}，空枪 ${state.empty}。${reward === 10 ? '熟练完成，达到 80% 奖励档位。' : reward === 5 ? '完成掩护，达到 40% 奖励档位。' : '有效命中率不足 40%，本轮奖励为 0。'}`;
  if (network) { notice('掩护结束，正在同步服务端结算。'); updateStats(); return; }
  $('result').hidden = false;
  updateStats();
  $('restart').focus();
}
function resolveDodge(success) {
  if (!state.dodge) return;
  const direction = directions[state.dodge.direction];
  if (network) state.handledDodges.add(state.dodge.id);
  const elapsed = Date.now() - state.started;
  state.dodge = null;
  state.nextDodgeAt = elapsed + 8000 + Math.random() * 5000;
  $('dodge-cue').hidden = true;
  const field = $('field');
  field.classList.remove('evaded', 'wounded');
  void field.offsetWidth;
  if (success) {
    state.dodges += 1;
    field.style.setProperty('--evade-x', `${direction.x}px`);
    field.style.setProperty('--evade-y', `${direction.y}px`);
    field.classList.add('evaded');
    notice('闪避成功！子弹擦身而过。', 'good');
  } else {
    state.wounds += 1;
    field.classList.add('wounded');
    notice('被子弹击中 · 扣除 3 个有效命中', 'bad');
  }
  updateStats();
}
function attemptDodge(direction) {
  if (!state.active || !state.dodge) return;
  const elapsed = Date.now() - state.started;
  if (elapsed >= duration) { finish(); return; }
  if (network) network.action('tea_dodge', { cueId: state.dodge.id, direction, elapsed });
  resolveDodge(elapsed < state.dodge.deadline && direction === state.dodge.direction);
}
$('field').addEventListener('pointerdown', (event) => {
  if (!state.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
}, true);
$('field').addEventListener('pointerup', (event) => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  gesture = null;
  if (Math.hypot(dx, dy) < 40) return;
  suppressClickUntil = Date.now() + 500;
  const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  attemptDodge(direction);
}, true);
$('field').addEventListener('pointercancel', () => { gesture = null; }, true);
$('field').addEventListener('click', (event) => {
  if (Date.now() < suppressClickUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
document.addEventListener('keydown', (event) => {
  const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  if (!state.active || !state.dodge || event.repeat || !keys[event.key]) return;
  event.preventDefault();
  attemptDodge(keys[event.key]);
});
$('start').addEventListener('click', () => {
  if (network) { network.action('start', { type: 'str' }); return; }
  if (state.active) return;
  state.active = true;
  state.started = Date.now();
  $('intro').hidden = true;
  tick();
});
$('restart').addEventListener('click', reset);
function drawScenery() {
  const ctx = $('scenery').getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 540);
  sky.addColorStop(0, '#697d67'); sky.addColorStop(.48, '#344e3a'); sky.addColorStop(1, '#1e3626');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1200, 540);
  for (let i = 0; i < 22; i++) {
    const x = i * 61 - 30;
    ctx.fillStyle = i % 2 ? '#2b4435' : '#3c5540';
    ctx.fillRect(x, 0, 14 + i % 4 * 4, 330);
    ctx.beginPath(); ctx.ellipse(x + 5, 40 + i % 3 * 22, 100, 80, -.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#777b5b'; ctx.beginPath(); ctx.moveTo(560, 190); ctx.lineTo(660, 190); ctx.lineTo(1100, 540); ctx.lineTo(200, 540); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5b6850'; ctx.fillRect(290, 290, 285, 62); ctx.fillStyle = '#899075'; ctx.fillRect(284, 284, 298, 12);
  ctx.strokeStyle = '#354c38';ctx.lineWidth = 2;
  for(let row=0;row<3;row++)for(let col=0;col<7;col++)ctx.strokeRect(290+col*44-(row%2)*18,299+row*17,44,17);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 11; col++) {
    const x = col * 120 + (row % 2) * 28;
    const y = 265 + row * 85;
    if (col > 3 && col < 7) continue;
    ctx.fillStyle = ['#304d32','#3b5938','#476242','#24442d'][row];
    ctx.beginPath(); ctx.ellipse(x, y, 95, 37 + row * 5, -.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#81926640'; ctx.beginPath(); ctx.ellipse(x - 5, y - 8, 73, 20, -.12, Math.PI, Math.PI * 2); ctx.stroke();
  }
}
drawScenery();
reset();

if (new URLSearchParams(location.search).has('network')) {
  let attemptId = null;
  network = connectQueuedGame(snapshot => {
    const attempt = snapshot.attempt;
    if (!attempt?.tea) return;
    const tea = attempt.tea;
    if (attemptId !== attempt.id) {
      reset();
      attemptId = attempt.id;
      state.schedule = tea.schedule;
      state.dodgeSchedule = tea.dodges;
      state.handledDodges = new Set(tea.dodgeIds);
      state.active = !attempt.done;
      state.started = Date.now() - attempt.elapsed;
      $('intro').hidden = true;
    }
    state.hitIds = new Set(tea.shotIds);
    state.hits = tea.hits;
    state.friendlyHits = tea.friendlyHits;
    state.empty = tea.empty;
    state.shots = tea.hits + tea.friendlyHits + tea.empty;
    state.lastShot = Math.max(state.lastShot, state.started + tea.lastShot);
    state.wounds = tea.wounds;
    state.dodges = tea.evaded;
    tea.dodgeIds.forEach(id => state.handledDodges.add(id));
    for (const { event } of state.targets.values()) if (state.hitIds.has(event.id)) removeTarget(event);
    updateStats();
    cancelAnimationFrame(frame);
    if (state.active) tick();
  });
  document.querySelector('footer').lastElementChild.textContent = '联网任务 · 奖励由服务端结算';
}
