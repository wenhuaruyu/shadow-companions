const clues = [
  { id: 'A', text: '今早运木头的马车全堵在路口。几个穿黑胶鞋的货商在茶馆门口抽了半个钟头烟，连货担都不管了。', answer: 'west' },
  { id: 'B', text: '卖茶叶的老汉今天宁可绕十里地，也不肯走北边的青石板路，说林子里一上午连个鸟叫都没有。', answer: 'north' },
  { id: 'C', text: '老陈昨晚带着好酒去见南边守路的军官，今早传回口信：“交涉有了着落，照约定带上大洋。”', answer: 'south' },
  { id: 'D', text: '后山短枪队传来口信：今晚启用三位路线代号。接应队就位后，会由交通员送来电报，凭随身数字码本译读。', answer: 'inbox' },
  { id: 'E', text: '日伪军这几天查得很严，听说已经抓走了几个没带良民证的商贩。', answer: 'inbox' },
  { id: 'F', text: '随行人员发现，茅盾先生的鞋子磨破了底。若继续赶路，需要替他找一双能走山路的鞋。', answer: 'inbox' },
];
const routes = [
  { id: 'west', name: '西侧主道', hint: '车马往来 · 通往镇口', truth: '重兵设卡 · 便衣伪装成货商，正在监视过路人。' },
  { id: 'north', name: '北侧青石古道', hint: '林深路静 · 远离哨卡', truth: '疑有埋伏 · 当地人主动避让，林间异常安静。' },
  { id: 'south', name: '南侧密林道', hint: '林场小径 · 驻军把守', truth: '可以交涉 · 守路军官已答应，需按约携带大洋。' },
  { id: 'inbox', name: '暂存情报', hint: '与接应、准备或整体局势有关', truth: '行动准备 · 三条消息无法直接确定路线安全性。' },
];
const $ = (id) => document.getElementById(id);
const duration = 120000;
const numericMorse = ['━━━━━', '·━━━━', '··━━━', '···━━', '····━', '·····', '━····', '━━···', '━━━··', '━━━━·'];
function morseSymbols(code) {
  return `<span class="morse-symbols" role="img" aria-label="${code.replaceAll('·', '点 ').replaceAll('━', '划 ')}">${[...code].map((symbol) => `<i class="${symbol === '·' ? 'dot' : 'dash'}" aria-hidden="true"></i>`).join('')}</span>`;
}
$('codebook').innerHTML = numericMorse.map((code, digit) => `<span><b>${digit}</b>${morseSymbols(code)}</span>`).join('');
let state;
let interval;
function reset() {
  clearInterval(interval);
  const codes = new Set();
  while (codes.size < 3) codes.add(String(Math.floor(100 + Math.random() * 900)));
  const [west, north, south] = [...codes];
  state = { codes: { west, north, south }, phase: 'intro', memoryUntil: 0, peekUntil: 0, assignments: {}, locked: new Set(), selected: null, route: null, mistakes: 0, deadline: 0, remaining: duration };
  $('decoded').value = '';
  $('signal').innerHTML = state.codes.south.split('').map((digit) => morseSymbols(numericMorse[Number(digit)])).join('<span class="signal-divider" aria-hidden="true">/</span>');
  $('route-codes').textContent = '';
  $('submit').onclick = null;
  $('intro').hidden = false;
  $('result').hidden = true;
  $('review').textContent = '回看情报';
  render();
  feedback('整理六条消息，找出可以通行的路线。');
}
function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}
function render() {
  const picking = state.phase === 'route';
  const ended = state.phase === 'ended';
  const decoding = state.phase === 'morse';
  const memorizing = state.phase === 'memory';
  const peeking = decoding && state.peekUntil > Date.now();
  document.querySelector('.board').hidden = decoding || memorizing;
  $('morse-panel').hidden = !(decoding || memorizing);
  $('codebook-area').hidden = !(memorizing || peeking);
  $('cipher-area').hidden = !decoding;
  $('decoded').disabled = peeking;
  $('peek').disabled = peeking;
  $('memory-story').hidden = !memorizing;
  $('morse-title').textContent = memorizing ? '记住随身码本' : '译出接应电报';
  $('route-codes').hidden = !picking;
  if (picking) $('route-codes').textContent = `译文 ${state.codes.south} 对应南侧密林道。接应队已在此就位，请对照情报确认出发。`;
  $('route-reveal').hidden = !picking;
  $('route-reveal').textContent = picking ? `译文 ${state.codes.south} → 南侧密林道。接应队已就位，请对照情报选择路线。` : '';
  updateMemoryClock();
  $('mistakes').textContent = `失误 ${state.mistakes}`;
  $('progress').textContent = `已确认 ${state.locked.size} / 6`;
  $('step').textContent = memorizing ? '码本记忆' : decoding ? '电码破译' : picking ? '路线抉择' : ended ? '本轮已结束' : '情报归档';
  $('instruction').textContent = memorizing ? '你有 20 秒记忆数字码本。收起后，再接收电报。' : decoding ? '凭记忆译出三位数字。译对后才会揭示对应路线。' : picking ? '情报已核实。选中一条撤离路线，再确认出发。' : '点击一张情报卡，再点击右侧的归档区域。';
  $('route-label').textContent = picking ? '路线档案 · 选择撤离路线' : '路线档案 · 选择归档位置';
  $('clues').replaceChildren(...clues.map((clue) => {
    const button = document.createElement('button');
    const locked = state.locked.has(clue.id);
    button.className = `clue${state.selected === clue.id ? ' selected' : ''}${locked ? ' locked' : ''}`;
    button.disabled = state.phase !== 'archive' || locked;
    button.setAttribute('aria-pressed', String(state.selected === clue.id));
    const destination = routes.find((route) => route.id === state.assignments[clue.id]);
    button.innerHTML = `<span class="clue-id">情报 ${clue.id}</span><span class="clue-text">${clue.text}</span><span class="tag">${locked ? '已确认 · ' : ''}${destination?.name || '尚未归档'}</span>`;
    button.addEventListener('click', () => {
      if (expired()) return;
      state.selected = clue.id;
      render();
      feedback(`已选中情报 ${clue.id}，请点击右侧归档区域。`);
    });
    return button;
  }));
  $('routes').replaceChildren(...routes.map((route) => {
    const button = document.createElement('button');
    const count = Object.values(state.assignments).filter((id) => id === route.id).length;
    button.className = `route${route.id === 'inbox' ? ' inbox' : ''}${state.route === route.id ? ' chosen' : ''}`;
    button.disabled = ended || state.phase === 'intro' || (picking && route.id === 'inbox');
    button.setAttribute('aria-pressed', String(state.route === route.id));
    const reveal = state.locked.size === 6;
    button.innerHTML = `<span class="route-top"><strong>${route.name}</strong><small>${picking ? (route.id === 'inbox' ? '辅助信息' : '选择此路') : `${count} 条情报`}</small></span><span class="route-detail">${reveal ? route.truth : route.hint}</span>`;
    button.addEventListener('click', () => {
      if (expired()) return;
      if (state.phase === 'route') {
        state.route = route.id;
        feedback(`已选择${route.name}，确认后出发。`);
      } else if (state.selected) {
        state.assignments[state.selected] = route.id;
        state.selected = null;
        feedback('已归档。可以继续整理，也可以点击情报卡调整位置。');
      } else feedback('请先点击左侧的一张情报卡。', true);
      render();
    });
    return button;
  }));
  $('submit').textContent = memorizing ? '记好了，收起码本' : decoding ? '核对译文' : picking ? '确认出发' : '提交判断';
  $('submit').disabled = memorizing ? false : decoding ? peeking : picking ? !state.route : state.phase !== 'archive' || Object.keys(state.assignments).length !== 6;
  renderTimer();
}
function renderTimer() {
  const seconds = Math.ceil(state.remaining / 1000);
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('urgent', seconds <= 20);
}
function expired() {
  if (!['archive', 'memory', 'morse', 'route'].includes(state.phase)) return true;
  state.remaining = Math.max(0, state.deadline - Date.now());
  if (state.remaining === 0) { finish(false); return true; }
  return false;
}
function finish(success) {
  clearInterval(interval);
  state.remaining = Math.max(0, state.deadline - Date.now());
  state.phase = 'ended';
  state.selected = null;
  const reward = success ? (state.mistakes <= 1 ? 10 : 5) : 0;
  $('result-kicker').textContent = success ? '第三幕 · 情报任务完成' : '第三幕 · 折戟茶园';
  $('result-title').textContent = success ? '穿过迷雾' : '错过通行窗口';
  $('result-story').textContent = success ? '电报中的路线代号与南侧密林道吻合，短枪队已经就位。你将译文交给同伴：“守路军官肯交涉，接应也确认了。带上约定的大洋，我们从南边走。”队伍趁换防间隙进入茶林。' : '迟迟无法确定撤离路线，茶园外传来巡逻队的脚步声。队伍错过了短暂的通行窗口，只能重新寻找机会。';
  $('reward').textContent = `智力 +${reward}`;
  $('result-mistakes').textContent = state.mistakes;
  $('result-time').textContent = `${Math.min(120, Math.ceil((duration - state.remaining) / 1000))} 秒`;
  $('result-note').textContent = success ? (reward === 10 ? '熟练完成 · 在时限内选对路线，累计失误不超过 1 次。' : '完成 · 在时限内选对路线，累计失误达到 2 次或以上。') : '未完成 · 本轮奖励为 0，重新挑战会清空本轮结果。';
  $('result').hidden = false;
  render();
  $('restart').focus();
}
$('start').addEventListener('click', () => {
  state.phase = 'archive';
  state.deadline = Date.now() + duration;
  $('intro').hidden = true;
  render();
  interval = setInterval(() => {
    if (expired()) return;
    if (state.phase === 'memory' && Date.now() >= state.memoryUntil) beginDecoding();
    if (state.phase === 'morse' && state.peekUntil && Date.now() >= state.peekUntil) {
      state.peekUntil = 0;
      render();
      feedback('码本已收起，请继续译码。');
    }
    updateMemoryClock();
    renderTimer();
  }, 100);
});
$('submit').addEventListener('click', () => {
  if (expired()) return;
  if (state.phase === 'memory') { beginDecoding(); return; }
  if (state.phase === 'morse') {
    if (state.peekUntil > Date.now()) return;
    const decoded = $('decoded').value.trim();
    if (!/^\d{3}$/.test(decoded)) {
      feedback('请输入完整的三位数字，再核对译文。', true);
      return;
    }
    if (decoded !== state.codes.south) {
      state.mistakes += 1;
      render();
      feedback('译文与电报码不符。注意每组的点划数量，失误 +1。', true);
      return;
    }
    state.phase = 'route';
    render();
    feedback(`电码译文 ${decoded} 已核实。请结合路线代号与情报，确认撤离路线。`);
    return;
  }
  if (state.phase === 'route') {
    if (state.route === 'south') return finish(true);
    state.mistakes += 1;
    const chosen = routes.find((route) => route.id === state.route);
    state.route = null;
    render();
    feedback(`${chosen.name}风险过高，请重新阅读已核实的路线情报。失误 +1。`, true);
    return;
  }
  let wrong = 0;
  for (const clue of clues) {
    if (state.locked.has(clue.id)) continue;
    if (state.assignments[clue.id] === clue.answer) state.locked.add(clue.id);
    else { delete state.assignments[clue.id]; wrong += 1; }
  }
  state.mistakes += wrong;
  state.selected = null;
  if (state.locked.size === 6) {
    state.phase = 'memory';
    state.memoryUntil = Date.now() + 20000;
    feedback('交通员正在抄收回电。趁这 20 秒记住码本，稍后码本将收起。');
  } else feedback(`${wrong} 条情报不符，已退回待整理区域。正确情报已锁定，请调整后重新提交。失误 +${wrong}。`, true);
  render();
});

function updateMemoryClock() {
  const until = state.phase === 'memory' ? state.memoryUntil : state.peekUntil;
  $('memory-clock').textContent = `${state.phase === 'memory' ? '记忆时间' : '码本将在'} ${Math.max(0, Math.ceil((until - Date.now()) / 1000))} 秒${state.phase === 'memory' ? '' : '后收起'}`;
}
function beginDecoding() {
  state.phase = 'morse';
  state.peekUntil = 0;
  render();
  feedback('码本已收起，接应电报送到了。请凭记忆译出三位数字。');
  $('decoded').focus();
}
$('peek').addEventListener('click', () => {
  if (expired() || state.phase !== 'morse' || state.peekUntil > Date.now()) return;
  state.mistakes += 1;
  state.peekUntil = Date.now() + 5000;
  render();
  feedback('重新查看码本 5 秒，失误 +1。查看结束后继续输入。', true);
});

$('restart').addEventListener('click', reset);
$('review').addEventListener('click', () => {
  $('result').hidden = true;
  feedback('本轮已结束，可以回看你的归档结果。点击下方按钮重新挑战。');
  $('submit').textContent = '重新挑战';
  $('submit').disabled = false;
  $('submit').onclick = () => { $('submit').onclick = null; reset(); };
});
reset();
