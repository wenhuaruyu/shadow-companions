import { createApiClient } from './api/client.js';
import { readSession } from './state/storage.js';
import { applySnapshot } from './state/snapshot.js';

// Original scene links remain the authority for narrative navigation.
export function createDesignNetwork({ show, getScene, stage, notice }) {
  const invite = new URLSearchParams(location.search).get('invite');
  const storage = sessionStorage;
  let session = invite ? null : readSession(storage) || readSession(localStorage);
  if (invite) storage.removeItem('anxian.session.v2');
  let snapshot = null;
  let busy = false;
  let lastPhase = '';
  let choice = null;
  let privateRole = null;
  let rewardAcknowledged = null;
  let pendingInvestment = null;
  let returnScene = null;
  let gameFrame = null;
  const client = createApiClient({ storage, rulesVersion: 'chapter-games-1', getSession: () => session, getSnapshot: () => snapshot });
  function mountRoomJoin(scene) {
    const lobby = ['3:80', '3:137', '3:245', '3:306'].includes(scene.id);
    if (!lobby) return;
    const panel = stage.querySelector('[data-name="任务与操作面板"]');
    if (!panel) return;
    const form = document.createElement('form');
    form.id = 'room-join';
    form.className = 'room-join-form';
    form.innerHTML = '<label for="join-room-code">房间号加入：</label><input id="join-room-code" autocomplete="off" required placeholder="输入房间号"><button type="submit">加入</button><p id="join-room-error" role="alert"></p>';
    form.onsubmit = async event => {
      event.preventDefault();
      const room = form.querySelector('input').value.trim().toLowerCase();
      const error = form.querySelector('#join-room-error');
      error.textContent = '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(room)) {
        error.textContent = '请粘贴完整的房间号'; return;
      }
      const submit = form.querySelector('button');
      submit.disabled = true;
      try { await enter(true, room); }
      finally { submit.disabled = false; }
    };
      panel.classList.add('room-lobby-panel');
      panel.style.maxHeight = `${374 - (parseFloat(getComputedStyle(panel).top) || 60)}px`;
      const invite = panel.querySelector('[data-action-name*="复制邀请"]');
      const code = panel.querySelector('[data-action-name*="分享"]');
      if (invite && code) {
        const actions = document.createElement('div'); actions.className = 'room-copy-actions';
        invite.before(actions); actions.append(invite, code);
        code.querySelector('p').textContent = '复制房间号';
        code.onclick = async event => {
          event.stopPropagation();
          try { await navigator.clipboard.writeText(snapshot.id); notice.textContent = '房间号已复制'; }
          catch { notice.textContent = `房间号：${snapshot.id}`; }
        };
      }
      const exit = panel.querySelector('[data-action-name*="退出当前"]');
      if (exit) exit.before(form);
      else panel.append(form);
  }
  const mine = () => snapshot.players[snapshot.me];
  function clearCredential() {
    storage.removeItem('anxian.session.v2');
    if (readSession(localStorage)?.token === session?.token) localStorage.removeItem('anxian.session.v2');
  }
  async function accept(response, force = false) {
    snapshot = applySnapshot(snapshot, response);
    if (!snapshot) return;
    const key = `${snapshot.chapter}.${snapshot.phase}.${snapshot.attempt?.id}.${snapshot.attempt?.done}.${Boolean(mine().investment)}.${mine().taskChoice}.${snapshot.phase === 'lobby' ? snapshot.players.map(p => p.ready).join(',') : ''}`;
    if (!force && key === lastPhase) { decorate(); return; }
    lastPhase = key;
    if (gameFrame && (snapshot.phase !== 'event' || snapshot.attempt?.done)) { gameFrame.remove(); gameFrame = null; }
    switch (snapshot.phase) {
      case 'lobby': await show(snapshot.players.length === 1 ? '3:80' : mine().ready ? '3:306' : '3:245'); break;
      case 'brief': await show('30:108'); break;
      case 'map': await show(snapshot.chapter ? '3:1906' : '3:471'); break;
      case 'story': {
        const saved = sessionStorage.getItem(`anxian.scene.${snapshot.id}.${snapshot.chapter}`);
        await show(saved || (snapshot.chapter ? '3:1967' : '3:698')); break;
      }
      case 'event':
        if (snapshot.chapter === 0 && mine().taskChoice && !snapshot.attempt?.done) { await game(); break; }
        if (snapshot.attempt && !snapshot.attempt.done) await game();
        else if (snapshot.attempt?.done) await show((snapshot.attempt.type === 'str' || snapshot.cooperative?.role === 'str') ? '3:1607' : '3:1305');
        else await show('3:934');
        break;
      case 'invest': await show(rewardAcknowledged !== snapshot.attempt.id ? (snapshot.attempt.type === 'str' || snapshot.cooperative?.role === 'str') ? '3:1607' : '3:1305' : mine().investment ? '3:1788' : snapshot.chapter ? '3:2574' : '3:1666'); break;
      case 'result': await show(snapshot.records.at(-1).success ? snapshot.chapter ? '287:1764' : '3:1847' : '6:2720'); break;
      case 'complete': await show(sessionStorage.getItem(`anxian.epilogue.${snapshot.id}`) || '368:120'); break;
      default: await show('6:2538');
    }
    decorate();
  }
  async function action(kind, data = {}) {
    if (busy) return;
    busy = true;
    notice.textContent = '正在同步…';
    try {
      let response;
      try { response = await client.action(kind, data); }
      catch (error) {
        if (error.code !== 'VERSION_CONFLICT') throw error;
        const previous = snapshot;
        snapshot = applySnapshot(snapshot, await client.state(true));
        if (snapshot.phase !== previous.phase || snapshot.chapter !== previous.chapter) { await accept({ snapshot }, true); throw error; }
        response = await client.action(kind, data);
      }
      await accept(response); notice.textContent = '';
    }
    catch (error) {
      notice.textContent = error.message;
      gameFrame?.contentWindow.postMessage({ type: 'anxian-game-error', message: error.message }, location.origin);
      if (error.code === 'VERSION_CONFLICT') await accept(await client.state(true), true);
      const pending = client.pending();
      if (pending) {
        const retry = document.createElement('button'); retry.textContent = '重试上次操作';
        retry.onclick = () => action(pending.kind, pending.data); notice.append(retry);
      }
    } finally { busy = false; }
  }
  async function enter(joining = false, room = invite) {
    if (busy) return;
    busy = true;
    try {
      const response = joining ? await client.join(room) : await client.create();
      if (session?.token !== response.session.token) storage.removeItem(`anxian.action.v2.${response.session.id}`);
      session = response.session;
      history.replaceState(null, '', location.pathname);
      await accept(response, true);
      return true;
    } catch (error) {
      notice.textContent = error.message;
      const dialogError = document.querySelector('#join-room-error');
      if (dialogError) dialogError.textContent = error.message;
      return false;
    }
    finally { busy = false; }
  }
  function decorate() {
    broadcastGame();
    if (!snapshot) return;
    for (const node of stage.querySelectorAll('p')) {
      if (/智力\s*\d+\s*武力\s*\d+/.test(node.textContent)) {
        const card = node.closest('[data-name]');
        const name = card?.parentElement?.textContent || '';
        const seat = /林栩/.test(name) ? 1 : 0;
        const player = snapshot.players[seat];
        if (player) node.textContent = `智力 ${player.int}    武力 ${player.str}`;
      }
    }
    for (const node of stage.querySelectorAll('p')) {
      if (node.textContent.includes('https://game.example/invite/041')) {
        node.textContent = `房间号：${snapshot.id}`;
        const link = document.createElement('span'); link.textContent = `${location.origin}/online.html?invite=${snapshot.id}`; link.style.display = 'block'; link.style.fontSize = '10px'; link.style.whiteSpace = 'nowrap'; link.style.overflow = 'hidden'; link.style.textOverflow = 'ellipsis'; link.title = link.textContent; node.dataset.room = snapshot.id; node.append(link);
        node.style.overflowWrap = 'anywhere';
        node.style.height = 'auto';
        node.style.userSelect = 'text';
      }
    }
    const pending = client.pending();
    if (pending && !notice.querySelector('button')) {
      const retry = document.createElement('button'); retry.textContent = '重试上次操作';
      retry.onclick = () => action(pending.kind, pending.data); notice.append(retry);
    }
    for (const button of stage.querySelectorAll('[data-action-name*="演示"]')) {
      const text = button.querySelector('p'); if (text) text.textContent = '等待同伴'; button.disabled = true;
    }
    if (getScene()?.id === '3:1788' && mine().investment) {
      const lines = stage.querySelectorAll('[data-node-id="49:173"] p');
      lines[0].textContent = `你的投入：智力${mine().investment.int} / 武力${mine().investment.str}`;
      lines[1].textContent = `你的余额：智力${mine().int} / 武力${mine().str}`;
    }
    if (getScene()?.id === '3:1727' && pendingInvestment) {
      stage.querySelector('[data-node-id="49:167"]').textContent = `投入智力${pendingInvestment.int}、武力${pendingInvestment.str}？`;
      stage.querySelector('[data-node-id="49:168"] p').textContent = `确认后剩余：智力${mine().int - pendingInvestment.int} / 武力${mine().str - pendingInvestment.str}。`;
    }
    if (snapshot.phase === 'lobby') {
      const cards = stage.querySelectorAll('[data-name^="玩家 /"]');
      cards.forEach((card, seat) => {
        const lines = card.querySelectorAll('p');
        if (lines[0]) lines[0].textContent = `玩家${seat ? '乙' : '甲'}${seat === snapshot.me ? ' · 你' : ''}`;
        if (lines[1]) lines[1].textContent = snapshot.players[seat]?.ready ? '已準備' : '未準備';
      });
      for (const node of stage.querySelectorAll('p')) if (/玩家甲：/.test(node.textContent)) node.textContent = snapshot.players.map((p,i) => `玩家${i ? '乙' : '甲'}：${p.ready ? '已準備' : '未準備'}`).join('    ');
    }
    if (snapshot.phase === 'event' && snapshot.chapter === 0 && !snapshot.attempt) {
      const companion = snapshot.players.find((_, seat) => seat !== snapshot.me);
      const other = companion?.taskChoice ? { type: companion.taskChoice, done: companion.event?.done } : companion?.event;
      for (const button of stage.querySelectorAll('[data-destination="3:996"], [data-destination="3:1364"]')) {
        const type = button.dataset.destination === '3:996' ? 'int' : 'str';
        button.disabled = other?.type === type;
        if (button.disabled) { const label = other.done ? '此任务已完成' : '此任务已有人正在完成'; button.setAttribute('aria-label', label); const text = button.querySelector('p'); if (text) text.textContent = label; }
      }
      const current = getScene()?.id;
      if (other && (current === '3:996' && other.type === 'int' || current === '3:1364' && other.type === 'str')) {
        notice.textContent = '同伴已开始这项任务，请选择另一项。'; show('3:934');
      }
    }
    const scene = getScene();
    if (['3:1305', '3:1607'].includes(scene?.id)) {
      for (const node of stage.querySelectorAll('p')) {
        if (/\+\s*\d+/.test(node.textContent)) node.textContent = `${scene.id === '3:1607' ? '武力' : '智力'} +${snapshot.attempt?.reward || 0}`;
        if (/現有智力|現有武力|現有武/.test(node.textContent)) node.textContent = `当前智力 ${mine().int} / 武力 ${mine().str}`;
      }
    }
    if (snapshot.phase === 'invest' && ['3:1666', '3:2574'].includes(scene?.id) && !mine().investment && !stage.querySelector('#design-int')) {
      const content = stage.querySelector('[data-node-id="49:163"], [data-node-id="49:208"]');
      if (content) {
        content.replaceChildren();
        for (const attribute of ['int', 'str']) {
          const label = document.createElement('label');
          label.textContent = `${attribute === 'int' ? '智力' : '武力'}投入（余额 ${mine()[attribute]}） `;
          const input = document.createElement('input'); input.id = `design-${attribute}`;
          input.type = 'number'; input.min = '0'; input.max = String(mine()[attribute]); input.value = String(pendingInvestment?.[attribute] || 0);
          label.append(input); content.append(label, document.createElement('br'));
        }
        const need = document.createElement('p'); need.textContent = `需求 智力 ${snapshot.requirements.int} / 武力 ${snapshot.requirements.str}`; content.append(need);
      }
    }

  }
  function broadcastGame() {
    if (!gameFrame || !snapshot) return;
    const age = Math.max(0, performance.now() - snapshot.receivedAt);
    const current = {
      ...snapshot,
      ...(snapshot.attempt && !snapshot.attempt.done && snapshot.attempt.startedAt !== null ? {
        attempt: { ...snapshot.attempt, elapsed: Math.min(snapshot.attempt.duration, snapshot.attempt.elapsed + age) }
      } : {}),
      ...(snapshot.cooperative ? { cooperative: {
        ...snapshot.cooperative,
        serverNow: snapshot.cooperative.serverNow + age,
        remaining: snapshot.cooperative.phase === 'coop-lobby' ? snapshot.cooperative.remaining : Math.max(0, snapshot.cooperative.remaining - age),
        cooldown: Math.max(0, snapshot.cooperative.cooldown - age)
      } } : {})
    };
    gameFrame.contentWindow.postMessage({ type: 'anxian-game-state', snapshot: current }, location.origin);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== gameFrame?.contentWindow) return;
    if (event.data?.type === 'anxian-game-ready') broadcastGame();
    if (event.data?.type === 'anxian-game-action' && ['start', 'judge', 'alley_move', 'coop_role', 'coop_ready', 'coop_move', 'coop_light', 'coop_escape'].includes(event.data.kind)) {
      action(event.data.kind, event.data.data).finally(broadcastGame);
    }
  });
  async function game() {
    if (!gameFrame) {
      gameFrame = document.createElement('iframe');
      gameFrame.id = 'standalone-game';
      const name = snapshot.chapter === 1 ? 'cooperative' : mine().taskChoice === 'int' ? 'investigation' : 'strength';
      gameFrame.title = snapshot.chapter === 1 ? '第二章双人协作游戏' : mine().taskChoice === 'int' ? '第一章智力游戏' : '第一章武力游戏';
      gameFrame.src = `/games/${name}.html?network=1`;
      document.body.append(gameFrame);
    }
    broadcastGame();
  }
  async function activate(element) {
    const name = element.dataset.actionName || '';
    const destination = element.dataset.destination;
    const current = getScene()?.id;
    if (session && !snapshot) { await accept(await client.state(true), true); return true; }
    if (snapshot?.ended && /返回开始|返回首页|重新开始/.test(name)) {
      clearCredential(); location.assign('/online.html'); return true;
    }
    if (!session) {
      if (/开始入口|開始入口/.test(name)) { await enter(); return true; }
      if (/加入游戏/.test(name)) { await enter(true); return true; }
      return false;
    }
    if (current === '6:2476') {
      if (/退出并结束/.test(name)) await action('exit', { confirmed: true });
      else await show(returnScene);
      return true;
    }
    if (/退出当前/.test(name)) { returnScene = current; await show('6:2476'); return true; }
    if (/复制|複製|分享/.test(name)) {
      const link = `${location.origin}/online.html?invite=${snapshot.id}`;
      try { await navigator.clipboard.writeText(link); await show('3:137'); notice.textContent = '邀请链接已复制'; }
      catch { notice.textContent = link; }
      return true;
    }
    if (snapshot.phase === 'lobby') {
      if (/取消准备/.test(name)) await action('ready', { ready: false });
      else if (/准备/.test(name) && !/同伴/.test(name)) await action('ready', { ready: true });
      else if (/帮助/.test(name)) return false;
      return true;
    }
    if (snapshot.phase === 'brief') {
      if (destination === '30:170') {
        const instruction = await client.instruction();
        privateRole = /另有秘密|軍統|军统/.test(instruction.text) ? 'secret' : 'courier';
        await show(privateRole === 'secret' ? '99:341' : '30:170'); return true;
      }
      if (destination === '3:471') {
        if (!mine().instruction) await action('instruction');
        if (!mine().tutorial) await action('tutorial');
        return true;
      }
    }
    if (snapshot.phase === 'map') {
      if (/銅鑼灣|铜锣湾/.test(name) && snapshot.chapter === 0 || /紅磡|红磡/.test(name) && snapshot.chapter === 1) {
        await action('enter'); return true;
      }
      notice.textContent = '请先完成当前地点'; return true;
    }
    if (snapshot.phase === 'story' && ['3:934', '3:2203'].includes(destination)) { await action('read'); return true; }
    if (snapshot.phase === 'event') {
      if (snapshot.attempt?.done) { notice.textContent = '等待同伴完成小游戏'; return true; }
      if (snapshot.chapter === 0) {
        if (['3:996', '3:1364'].includes(current) && /开始/.test(name)) { await action('start', { type: current === '3:996' ? 'int' : 'str' }); return true; }
        if (destination === '3:996' || destination === '3:1364') {
          choice = destination === '3:996' ? 'int' : 'str';
          await action('choose', { type: choice });
          return true;
        }
      }
    }
    if (snapshot.phase === 'invest') {
      if (['3:1305', '3:1607'].includes(current)) { rewardAcknowledged = snapshot.attempt.id; await accept({ snapshot }, true); return true; }
      if (current === '3:1727') {
        if (/确认扣除/.test(name) && pendingInvestment) { await action('invest', pendingInvestment); pendingInvestment = null; }
        else if (/返回修改/.test(name)) await show(snapshot.chapter ? '3:2574' : '3:1666');
        return true;
      }
      if (/确认投入/.test(name)) {
        const int = Number(stage.querySelector('#design-int')?.value);
        const str = Number(stage.querySelector('#design-str')?.value);
        if (!Number.isSafeInteger(int) || !Number.isSafeInteger(str) || int < 0 || str < 0 || int > mine().int || str > mine().str) {
          notice.textContent = '请输入余额以内的非负整数'; return true;
        }
        pendingInvestment = { int, str }; await show('3:1727');
      }
      return true;
    }
    if (snapshot.phase === 'result') {
      if (destination === '3:1906' || destination === '368:120' || !snapshot.records.at(-1).success) {
        await action('continue'); return true;
      }
    }
    if (snapshot.phase === 'complete') return false;
    if (snapshot.ended) {
      clearCredential(); location.assign('/online.html'); return true;
    }
    return false;
  }
  async function shown(scene) {
    mountRoomJoin(scene);
    if (snapshot && ['3:1305', '3:1607'].includes(scene.id)) {
      if (!privateRole) {
        const instruction = await client.instruction();
        privateRole = /另有秘密|軍統|军统/.test(instruction.text) ? 'secret' : 'courier';
      }
      if (getScene()?.id !== scene.id) return;
      const portrait = stage.querySelector('[data-name*="立繪"]');
      if (portrait && privateRole === 'secret') {
        portrait.replaceChildren();
        portrait.dataset.name = '林栩／任务完成立绘';
        const image = document.createElement('img');
        image.src = '/assets/figma/1adc6.png'; image.alt = '林栩';
        image.className = 'absolute inset-0 max-w-none object-contain pointer-events-none size-full';
        portrait.append(image);
      } else if (portrait) portrait.querySelector('img').alt = '黄慕兰';
    }
    if (snapshot?.phase === 'complete') sessionStorage.setItem(`anxian.epilogue.${snapshot.id}`, scene.id);
    if (snapshot?.phase === 'story') sessionStorage.setItem(`anxian.scene.${snapshot.id}.${snapshot.chapter}`, scene.id);
    decorate();
  }
  let polling = false;
  async function poll() {
    if (!session || busy || polling || document.hidden) return;
    polling = true;
    try { await accept(await client.state()); }
    catch (error) { notice.textContent = error.message; }
    finally { polling = false; }
  }
  setInterval(poll, 1000);
  document.addEventListener('visibilitychange', poll);
  return { activate, shown, start: async () => {
    if (session) {
      try { await accept(await client.state(true), true); }
      catch (error) {
        if (['INVALID_CREDENTIAL', 'ROOM_NOT_FOUND'].includes(error.code)) {
          clearCredential(); session = null; await show('6:2236');
        } else await show('6:2416');
        notice.textContent = error.message;
      }
    }
    else if (invite) await show('3:192');
    else await show('3:25');
  } };
}
