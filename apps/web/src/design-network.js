import { clearTeaChapter, renderTeaLobby } from './screens/tea-chapter.js';
import { createApiClient } from './api/client.js';
import { readSession } from './state/storage.js';
import { applySnapshot } from './state/snapshot.js';
import { copyText } from './platform/clipboard.js';

// Original scene links remain the authority for narrative navigation.
export function createDesignNetwork({ show, getScene, stage, notice }) {
  const invite = new URLSearchParams(location.search).get('invite');
  const quickFourth = new URLSearchParams(location.search).get('chapter4') === '1';
  const quickThird = new URLSearchParams(location.search).get('chapter3') === '1';
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
  const client = createApiClient({ storage, rulesVersion: 'chapter-games-3', getSession: () => session, getSnapshot: () => snapshot });
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
          const room = snapshot.id;
          if (await copyText(room)) notice.textContent = '房间号已复制';
          else showManualCopy('房间号', room);
        };
      }
      const exit = panel.querySelector('[data-action-name*="退出当前"]');
      if (exit) exit.before(form);
      else panel.append(form);
  }
  function showManualCopy(label, value) {
    const dialog = document.querySelector('#modal');
    const content = dialog.querySelector('#modal-content');
    const title = document.createElement('p');
    title.textContent = '请长按下方内容，选择“复制”，再发给同伴。';
    const field = document.createElement('textarea');
    field.className = 'manual-copy-value';
    field.setAttribute('aria-label', label);
    field.readOnly = true;
    field.value = value;
    field.rows = label === '房间号' ? 2 : 3;
    field.addEventListener('click', () => field.select());
    content.replaceChildren(title, field);
    dialog.showModal();
    field.focus({ preventScroll: true });
    field.select();
    notice.textContent = '浏览器未允许自动复制，请长按复制';
  }
  const mine = () => snapshot.players[snapshot.me];
  function clearCredential() {
    storage.removeItem('anxian.session.v2');
    if (readSession(localStorage)?.token === session?.token) localStorage.removeItem('anxian.session.v2');
  }
  async function accept(response, force = false) {
    snapshot = applySnapshot(snapshot, response);
    if (!snapshot) return;
    if ((quickThird && snapshot.chapter === 2 || quickFourth && snapshot.chapter === 3) && ['lobby', 'brief'].includes(snapshot.phase)) {
      renderTeaLobby(snapshot, () => enter(), room => enter(true, room), action, snapshot.chapter);
      if (snapshot.phase === 'brief') setTimeout(() => {
        if (!busy && snapshot.phase === 'brief') action(mine().instruction ? 'tutorial' : 'instruction');
      }, 0);
      return;
    }
    clearTeaChapter();
    const key = `${snapshot.chapter}.${snapshot.phase}.${snapshot.attempt?.id}.${snapshot.attempt?.done}.${Boolean(mine().investment)}.${mine().taskChoice}.${snapshot.phase === 'lobby' ? snapshot.players.map(p => p.ready).join(',') : ''}`;
    if (!force && key === lastPhase) { decorate(); return; }
    lastPhase = key;
    if (gameFrame && (snapshot.phase !== 'event' || snapshot.attempt?.done)) { gameFrame.remove(); gameFrame = null; }
    switch (snapshot.phase) {
      case 'lobby': await show(snapshot.players.length === 1 ? '3:80' : mine().ready ? '3:306' : '3:245'); break;
      case 'brief': await show('30:108'); break;
      case 'map': await show(snapshot.chapter === 4 ? '443:121' : snapshot.chapter === 3 ? '368:192' : snapshot.chapter === 2 ? '368:120' : snapshot.chapter ? '3:1906' : '3:471'); break;
      case 'story': {
        const saved = sessionStorage.getItem(`anxian.scene.${snapshot.id}.${snapshot.chapter}`);
        await show(saved || (snapshot.chapter === 4 ? '443:186' : snapshot.chapter === 3 ? '367:690' : snapshot.chapter === 2 ? '367:81' : snapshot.chapter ? '3:1967' : '3:698')); break;
      }
      case 'event':
        if ([0, 2].includes(snapshot.chapter) && mine().taskChoice && !snapshot.attempt?.done) { await game(); break; }
        if (snapshot.attempt && !snapshot.attempt.done) await game();
        else if (snapshot.attempt?.done) await show((snapshot.attempt.type === 'str' || snapshot.cooperative?.role === 'str') ? '3:1607' : '3:1305');
        else await show('3:934');
        break;
      case 'invest': await show(rewardAcknowledged !== snapshot.attempt.id ? (snapshot.attempt.type === 'str' || snapshot.cooperative?.role === 'str') ? '3:1607' : '3:1305' : mine().investment ? '3:1788' : snapshot.chapter ? '3:2574' : '3:1666'); break;
      case 'result': await show(snapshot.records.at(-1).success ? snapshot.chapter === 3 ? (sessionStorage.getItem(`anxian.fourth-ending.${snapshot.id}`) || '367:1094') : snapshot.chapter === 2 ? (sessionStorage.getItem(`anxian.third-ending.${snapshot.id}`) || '367:562') : snapshot.chapter ? '287:1764' : '3:1847' : '6:2720'); break;
      case 'complete': await show(snapshot.chapter === 4 ? (sessionStorage.getItem(`anxian.epilogue.${snapshot.id}`) || '443:393') : snapshot.chapter === 3 ? (sessionStorage.getItem(`anxian.fourth-ending.${snapshot.id}`) || '367:1094') : snapshot.chapter === 2 ? (sessionStorage.getItem(`anxian.third-ending.${snapshot.id}`) || '367:647') : sessionStorage.getItem(`anxian.epilogue.${snapshot.id}`) || '368:120'); break;
      case 'failed': await show(snapshot.chapter === 3 ? '6:2720' : '6:2538'); break;
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
      history.replaceState(null, '', location.pathname + (quickFourth ? '?chapter4=1' : quickThird ? '?chapter3=1' : ''));
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
    if (snapshot?.chapter === 2 && getScene()?.id === '367:647' && mine().continued) {
      const label = stage.querySelector('[data-node-id="10:270"]');
      if (label) label.textContent = '等待同伴回到地图…';
    }
    broadcastGame();
    if ((quickThird || snapshot?.chapter === 2) && getScene()?.id === '368:120') {
      const point = stage.querySelector('[data-node-id="368:146"]');
      if (point) {
        point.disabled = false;
        point.setAttribute('aria-label', '第三章 · 惠阳茶园（已解锁）');
        const label = point.querySelector('p');
        if (label) label.textContent = '惠陽茶園 · 已解鎖';
      }
    }
    if (!snapshot) return;
    for (const node of stage.querySelectorAll('p')) {
      if (/智力\s*\d+\s*武力\s*\d+/.test(node.textContent)) {
        const card = node.closest('[data-name]');
        const name = card?.textContent || '';
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
    if (snapshot.phase === 'event' && [0, 2].includes(snapshot.chapter) && !snapshot.attempt) {
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
    if (snapshot.chapter === 3 && ['3:1305', '3:1607'].includes(scene?.id)) {
      const amount = snapshot.attempt.reward;
      stage.querySelector('[data-node-id="49:131"]').textContent = '第四章 · 五里亭交鋒 · 協作結算';
      stage.querySelector('[data-node-id="49:132"]').textContent = `智力 +${amount} · 武力 +${amount}`;
      const lines = stage.querySelectorAll('[data-node-id="49:133"] p');
      lines[0].textContent = amount === 10 ? '默契配合 · 兩人均有效出牌至少兩次' : '交涉成功 · 取得藥品與通行證';
      lines[1].textContent = `目前智力 ${mine().int} / 武力 ${mine().str}`;
      lines[2].textContent = '與同伴商量本關投入後，繼續撤離。';
    }
    if (snapshot.chapter === 2 && ['3:1305', '3:1607'].includes(scene?.id)) {
      const strength = snapshot.attempt.type === 'str';
      const summary = stage.querySelector(strength ? '[data-node-id="49:156"]' : '[data-node-id="49:131"]');
      if (summary) summary.textContent = `第三章 · ${strength ? '短槍掩護' : '茶園辨途'} · 任務結算`;
      const details = stage.querySelectorAll(strength ? '[data-node-id="49:158"] p' : '[data-node-id="49:133"] p');
      if (details[0]) details[0].textContent = snapshot.attempt.reward === 10 ? '表現出色，獲得最高檔獎勵。' : snapshot.attempt.reward === 5 ? '完成任務，獲得基礎獎勵。' : '本次獎勵 +0，可繼續與同伴商量投入。';
      if (details[1]) details[1].textContent = `目前智力 ${mine().int} / 武力 ${mine().str}`;
      if (details[2]) details[2].textContent = '雙方任務結束後，共同商量通關投入。';
    }
    if (snapshot.phase === 'invest' && ['3:1666', '3:2574'].includes(scene?.id) && !mine().investment && !stage.querySelector('#design-int')) {
      const content = stage.querySelector('[data-node-id="49:163"], [data-node-id="49:208"]');
      if (content) {
        content.replaceChildren();
        content.classList.add('investment-form');
        for (const attribute of ['int', 'str']) {
          const label = document.createElement('label');
          label.textContent = `${attribute === 'int' ? '智力' : '武力'}投入（余额 ${mine()[attribute]}） `;
          const input = document.createElement('input'); input.id = `design-${attribute}`;
          input.type = 'number'; input.inputMode = 'numeric'; input.step = '1';
          input.min = '0'; input.max = String(mine()[attribute]); input.value = String(pendingInvestment?.[attribute] || 0);
          label.htmlFor = input.id;
          const controls = document.createElement('span');
          controls.className = 'investment-controls';
          const buttons = [-1, 1].map(delta => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = delta < 0 ? '−' : '＋';
            button.setAttribute('aria-label', `${delta < 0 ? '减少' : '增加'}${attribute === 'int' ? '智力' : '武力'}投入`);
            button.onclick = event => {
              event.preventDefault();
              input.value = String(Math.max(0, Math.min(mine()[attribute], (Number(input.value) || 0) + delta)));
              input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            return button;
          });
          const updateButtons = () => {
            buttons[0].disabled = Number(input.value) <= 0;
            buttons[1].disabled = Number(input.value) >= mine()[attribute];
          };
          input.addEventListener('input', updateButtons);
          updateButtons();
          controls.append(buttons[0], input, buttons[1]);
          label.append(controls); content.append(label);
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
        attempt: { ...snapshot.attempt, elapsed: Math.min(snapshot.attempt.duration, snapshot.attempt.elapsed + age),
          ...(snapshot.attempt.tea && snapshot.attempt.type === 'int' ? { tea: { ...snapshot.attempt.tea,
            memoryRemaining: Math.max(0, snapshot.attempt.tea.memoryRemaining - age),
            peekRemaining: Math.max(0, snapshot.attempt.tea.peekRemaining - age)
          } } : {}) }
      } : {}),
      ...(snapshot.cards ? { cards: { ...snapshot.cards, serverNow: snapshot.cards.serverNow + age } } : {}),
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
    if (event.data?.type === 'anxian-game-action' && ['cards_ready', 'cards_play', 'start', 'judge', 'alley_move', 'coop_role', 'coop_ready', 'coop_move', 'coop_light', 'coop_escape', 'tea_archive', 'tea_memory', 'tea_peek', 'tea_decode', 'tea_route', 'tea_shot', 'tea_dodge'].includes(event.data.kind)) {
      const frame = gameFrame;
      action(event.data.kind, event.data.data).finally(() => {
        broadcastGame();
        frame?.contentWindow?.postMessage({ type: 'anxian-game-ack', actionId: event.data.actionId }, location.origin);
      });
    }
  });
  async function game() {
    if (!gameFrame) {
      gameFrame = document.createElement('iframe');
      gameFrame.id = 'standalone-game';
      const name = snapshot.chapter === 3 ? 'wuliting' : snapshot.chapter === 2 ? (mine().taskChoice === 'int' ? 'tea-garden' : 'tea-cover') : snapshot.chapter === 1 ? 'cooperative' : mine().taskChoice === 'int' ? 'investigation' : 'strength';
      gameFrame.title = snapshot.chapter === 3 ? '第四章五里亭交锋' : snapshot.chapter === 2 ? '第三章茶园任务' : snapshot.chapter === 1 ? '第二章双人协作游戏' : mine().taskChoice === 'int' ? '第一章智力游戏' : '第一章武力游戏';
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
      if (quickFourth && current === '368:192' && destination === '367:690') { await enter(); return true; }
      if (quickThird && current === '368:120' && destination === '367:81') { await enter(); return true; }
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
      if (await copyText(link)) {
        if (snapshot.phase === 'lobby') await show('3:137');
        notice.textContent = '邀请链接已复制';
      } else showManualCopy('邀请链接', link);
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
      if (snapshot.chapter === 4 && destination === '443:186' || snapshot.chapter === 3 && destination === '367:690' || snapshot.chapter === 2 && destination === '367:81' || /銅鑼灣|铜锣湾/.test(name) && snapshot.chapter === 0 || /紅磡|红磡/.test(name) && snapshot.chapter === 1) {
        await action('enter'); return true;
      }
      notice.textContent = '请先完成当前地点'; return true;
    }
    if (snapshot.chapter === 4 && snapshot.phase === 'story' && current === '443:370' && destination === '443:393') { await action('read'); return true; }
    if (snapshot.chapter === 3 && snapshot.phase === 'story' && current === '367:935' && destination === '367:1094') { await action('read'); return true; }
    if (snapshot.chapter === 2 && snapshot.phase === 'story' && current === '367:382' && destination === '367:562') { await action('read'); return true; }
    if (snapshot.phase === 'story' && ['3:934', '3:2203'].includes(destination)) { await action('read'); return true; }
    if (snapshot.phase === 'event') {
      if (snapshot.attempt?.done) { notice.textContent = '等待同伴完成小游戏'; return true; }
      if ([0, 2].includes(snapshot.chapter)) {
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
      if (destination === '3:1906' || destination === '368:120' || snapshot.chapter === 2 && current === '367:647' && destination === '367:690' || snapshot.chapter === 3 && current === '367:1295' && destination === '443:186' || !snapshot.records.at(-1).success) {
        if (snapshot.chapter === 3 && snapshot.records.at(-1).success) sessionStorage.setItem(`anxian.fourth-ending.${snapshot.id}`, '443:186');
        if (snapshot.chapter === 2 && snapshot.records.at(-1).success) sessionStorage.setItem(`anxian.third-ending.${snapshot.id}`, '367:647');
        await action('continue'); return true;
      }
    }
    if (snapshot.phase === 'complete') return false;
    if (snapshot.ended) {
      clearCredential(); location.assign('/online.html'); return true;
    }
    return false;
  }
  async function prepare(scene, container) {
    if (scene.id === '367:647') {
      container.querySelector('#node-10_275')?.remove();
      container.querySelector('[data-node-id="367:670"]')?.remove();
      const label = container.querySelector('[data-node-id="10:270"]');
      if (label) label.textContent = '回到地图';
      const target = container.querySelector('[data-node-id="367:672"]') || container.querySelector('#node-10_269');
      if (target) {
        target.dataset.nodeId = '367:672';
        target.setAttribute('aria-label', '回到地图');
      }
    }
    if (snapshot?.chapter === 3 && scene.id === '6:2720') {
      container.querySelector('[data-node-id="280:543"]').textContent = '第四章 · 五里亭查封';
      const lines = container.querySelectorAll('[data-node-id="280:544"] p');
      lines[0].textContent = snapshot.cards?.winner === 0 ? '王站長佔了上風，藥品與通行證被查扣。' : '共同投入未達通行要求，撤離行動受阻。';
      lines[1].textContent = '你和同伴的本次行動在此中斷。';
    }
    if (snapshot?.chapter === 2 && scene.id === '3:934') {
      const setText = (id, text) => { const node = container.querySelector(`[data-node-id="${id}"]`); if (node) node.textContent = text; };
      setText('49:101', '第三章 · 每人一次行動 / 剩餘 1');
      setText('49:102', '茶園行動 · 選擇你的分工');
      const descriptions = container.querySelectorAll('[data-node-id="49:103"] p');
      descriptions[0].textContent = '◇ 茶園辨途 · 120秒 · 智力 +0／5／10';
      descriptions[1].textContent = '✦ 短槍掩護 · 120秒 · 武力 +0／5／10';
      setText('10:270', '智力 · 茶園辨途');
      setText('10:276', '武力 · 短槍掩護');
    }
    if ([2, 3].includes(snapshot?.chapter) && scene.id === '3:2574') {
      container.querySelector('[data-node-id="49:207"]').textContent = snapshot.chapter === 3 ? '五里亭 · 共同投入' : '茶園撤離 · 共同投入';
    }
    if (snapshot && ['3:1305', '3:1607'].includes(scene.id)) {
      if (!privateRole) {
        const instruction = await client.instruction();
        privateRole = /另有秘密|軍統|军统/.test(instruction.text) ? 'secret' : 'courier';
      }
      const portrait = container.querySelector('[data-name*="立繪"]');
      if (portrait && privateRole === 'secret') {
        portrait.replaceChildren();
        portrait.dataset.name = '林栩／任务完成立绘';
        const image = document.createElement('img');
        image.src = '/assets/figma/1adc6.png'; image.alt = '林栩';
        image.className = 'absolute inset-0 max-w-none object-contain pointer-events-none size-full';
        portrait.append(image);
      } else if (portrait) portrait.querySelector('img').alt = '黄慕兰';
    }
  }
  async function shown(scene) {
    if (snapshot?.chapter === 2 && scene.id === '3:934') {
      document.title = '暗渡 1941 · 第三章 · 選擇分工';
      stage.setAttribute('aria-label', '第三章 · 茶園行動 · 選擇分工');
    }
    mountRoomJoin(scene);
    if (snapshot?.chapter === 3 && snapshot.phase === 'result' && scene.id.startsWith('367:')) sessionStorage.setItem(`anxian.fourth-ending.${snapshot.id}`, scene.id);
    if (snapshot?.chapter === 2 && snapshot.phase === 'result' && scene.id.startsWith('367:')) sessionStorage.setItem(`anxian.third-ending.${snapshot.id}`, scene.id);
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
  return { activate, prepare, shown, start: async () => {
    if (session) {
      try { await accept(await client.state(true), true); }
      catch (error) {
        if (['INVALID_CREDENTIAL', 'ROOM_NOT_FOUND'].includes(error.code)) {
          clearCredential(); session = null;
          if (quickFourth) await show('368:192');
          else if (quickThird) await show('368:120');
          else await show('6:2236');
        } else await show('6:2416');
        notice.textContent = error.message;
      }
    }
    else if (quickFourth || quickThird) {
      if (invite) await enter(true, invite);
      else await show(quickFourth ? '368:192' : '368:120');
    }
    else if (invite) await show('3:192');
    else await show('3:25');
  } };
}
