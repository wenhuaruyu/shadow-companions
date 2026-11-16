let root;
let lastKey;
export function clearTeaChapter() { root?.remove(); root = null; lastKey = null; }
export function renderTeaLobby(snapshot, create, join, action, chapter = 2) {
  if (!root) {
    root = document.createElement('section'); root.id = 'tea-chapter';
    root.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:25;overflow:auto;background:#152c20;color:#e8e4d1;padding:26px;font:15px/1.7 "PingFang SC",sans-serif';
    document.body.append(root);
  }
  const chapterName = chapter === 3 ? '第四章 · 五里亭交锋' : '第三章 · 惠阳茶园';
  const key = `lobby.${snapshot?.id}.${snapshot?.phase}.${snapshot?.players.map(player => player.ready).join()}`;
  if (key === lastKey) return;
  lastKey = key;
  const draft = root.querySelector('#tea-join-room')?.value || '';
  root.innerHTML = `<h1>${chapterName}</h1><p>双人本地联调</p><p>${chapter === 3 ? '两人轮流出牌，共同对抗王站长。双方准备后进入第四章地图。' : '一人完成情报归档与摩尔斯破译，一人完成射击与闪避。双方准备后进入茶园地图。'}</p><div id="tea-lobby-actions"></div><p id="tea-lobby-error" role="alert"></p>`;
  const controls = root.querySelector('#tea-lobby-actions');
  function button(text, handler, disabled = false) {
    const node = document.createElement('button'); node.textContent = text; node.disabled = disabled;
    node.style.cssText = 'font:inherit;padding:10px 22px;margin:6px;background:#d1b47d;border:0;color:#173322';
    node.onclick = async () => { node.disabled = true; try { await handler(); } catch (error) { root.querySelector('#tea-lobby-error').textContent = error.message; } finally { if (node.isConnected) node.disabled = disabled; } };
    controls.append(node);
  }
  if (!snapshot) {
    button(`创建第${chapter + 1}章测试房间`, create);
    const input = document.createElement('input'); input.id = 'tea-join-room'; input.placeholder = '粘贴同伴的房间号或邀请链接'; input.style.cssText = 'display:block;width:90%;max-width:600px;padding:10px;margin:12px 6px;font:inherit'; input.value = draft; controls.append(input);
    button(`加入第${chapter + 1}章测试房间`, () => {
      const value = input.value.trim();
      const room = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (!room) throw new Error('请填写完整房间号或邀请链接');
      return join(room);
    });
  } else if (snapshot.phase === 'brief') controls.textContent = `双方已准备，正在进入第${chapter + 1}章地图…`;
  else {
    const link = `${location.origin}/online.html?chapter${chapter + 1}=1&invite=${snapshot.id}`;
    const label = document.createElement('p'); label.textContent = '邀请链接（复制后在另一个标签页打开）'; controls.append(label);
    const input = document.createElement('input'); input.readOnly = true; input.value = link; input.setAttribute('aria-label', `第${chapter + 1}章邀请链接`); input.style.cssText = 'width:95%;padding:10px;font:inherit'; input.onclick = () => input.select(); controls.append(input);
    const status = document.createElement('p'); status.textContent = snapshot.players.map((player, seat) => `${seat === snapshot.me ? '你' : '同伴'}${player.ready ? '已准备' : '未准备'}`).join('，'); if(snapshot.players.length === 1) status.textContent += '，等待同伴加入'; controls.append(status);
    const mine = snapshot.players[snapshot.me];
    button(mine.ready ? '取消准备' : `准备进入第${chapter + 1}章`, () => action('ready', { ready: !mine.ready }));
  }
}
