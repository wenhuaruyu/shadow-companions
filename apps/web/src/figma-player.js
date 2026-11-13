import { escapeHtml } from './components/dom.js';

const stage = document.querySelector('#figma-stage');
const notice = document.querySelector('#preview-notice');
const picker = document.querySelector('#scene-picker');
const query = new URLSearchParams(location.search);
const preview = query.get('preview') === '1';
const cache = new Map();
let manifest;
let current;
let generation = 0;
let timer;
let showingCG = false;

function resize() {
  const scale = Math.min(innerWidth / 844, (innerHeight - 42) / 390);
  stage.style.transform = `scale(${Math.max(0.1, scale)})`;
}

function online() {
  const invite = query.get('invite');
  location.assign('/online.html' + (invite ? '?invite=' + encodeURIComponent(invite) : '?create=1'));
}

function resolveTarget(id) {
  const visited = new Set();
  let cg = false;
  while (!manifest.scenes.some(scene => scene.id === id) && !visited.has(id)) {
    visited.add(id);
    const first = manifest.cg.find(scene => scene.id === id);
    const alias = manifest.aliases.find(scene => scene.id === id);
    cg ||= Boolean(first);
    id = first?.destination || alias?.destination;
    if (!id) break;
  }
  return { id, cg };
}

async function show(id, { cg = false, replace = false } = {}) {
  const target = resolveTarget(id);
  const scene = manifest.scenes.find(item => item.id === target.id);
  if (!scene) {
    notice.textContent = '此分支尚未在目前設計中接續，請選擇其他場景。';
    return;
  }
  const version = ++generation;
  clearTimeout(timer);
  notice.textContent = '';
  try {
    if (!cache.has(scene.id)) {
      const response = await fetch(scene.file);
      if (!response.ok) throw new Error('頁面載入失敗');
      cache.set(scene.id, await response.text());
    }
    if (version !== generation) return;
    current = scene;
    stage.innerHTML = cache.get(scene.id);
    showingCG = cg || target.cg;
    stage.classList.toggle('cg-first', showingCG);
    stage.classList.toggle('opening', scene.id === '3:25');
    stage.classList.toggle('opening-finished', scene.id === '21:105');
    stage.setAttribute('aria-label', showingCG ? '場景CG，點擊顯示對話' : scene.name);
    stage.tabIndex = showingCG ? 0 : -1;
    picker.value = scene.id;
    document.title = `暗渡 1941 · ${scene.name.replace(/^\d+ \/ /, '')}`;
    const hash = '#' + scene.id.replace(':', '-');
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    wire(scene);
    identifyDialogue();
    if (!showingCG) schedule(scene);
  } catch (error) {
    notice.textContent = error.message + '，請重新載入。';
  }
}

function identifyDialogue() {
  const root = stage.firstElementChild;
  for (const child of root?.children || []) {
    const names = [child, ...child.querySelectorAll('[data-name]')].map(node => node.dataset.name || '');
    if (names.some(name => /StoryDialogue|内容自适应对话框|對話框|底部对话框|說話人|说话人姓名|姓名牌/.test(name))) {
      child.classList.add('scene-dialogue');
    }
  }
}

function schedule(scene) {
  const next = scene.links.find(link => link.trigger === 'AFTER_TIMEOUT');
  if (next && scene.id !== '3:25') timer = setTimeout(() => show(next.destination), (next.delay || 1) * 1000);
}

function wire(scene) {
  for (const link of scene.links.filter(item => item.trigger === 'ON_CLICK')) {
    const element = stage.querySelector(`[data-node-id="${CSS.escape(link.id)}"]`);
    if (!element) continue;
    element.dataset.destination = link.destination;
    element.dataset.actionName = link.name;
    if (element.tagName !== 'BUTTON') {
      element.setAttribute('role', 'button');
      element.tabIndex = 0;
    }
    if (!element.textContent.trim()) element.setAttribute('aria-label', link.name);
  }
  for (const button of stage.querySelectorAll('button:not([data-destination])')) {
    if (!button.querySelector('[data-destination]')) button.disabled = true;
  }
}

function activate(element) {
  if (!preview && /开始入口|開始入口|开始双人|開始雙人|加入/.test(element.dataset.actionName)) return online();
  if (/复制|複製|分享/.test(element.dataset.actionName)) {
    notice.textContent = '此為設計預覽。使用「雙人聯網」建立真實邀請。';
  }
  show(element.dataset.destination);
}

stage.addEventListener('click', event => {
  if (showingCG) {
    showingCG = false;
    stage.classList.remove('cg-first');
    schedule(current);
    return;
  }
  const action = event.target.closest('[data-destination]');
  if (action) activate(action);
});

stage.addEventListener('keydown', event => {
  if (showingCG && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    stage.click();
  } else if (event.key === 'Enter' && event.target.dataset.destination && event.target.tagName !== 'BUTTON') {
    activate(event.target);
  }
});

picker.addEventListener('change', () => show(picker.value));
document.querySelector('#online-entry').addEventListener('click', online);
document.querySelector('#preview-entry').addEventListener('click', () => location.assign('/?preview=1'));
window.addEventListener('resize', resize);
window.addEventListener('popstate', () => show(location.hash.slice(1).replace('-', ':'), { replace: true }));
resize();

try {
  const response = await fetch('/figma/manifest.json');
  if (!response.ok) throw new Error('設計資料載入失敗');
  manifest = await response.json();
  picker.innerHTML = manifest.scenes.map(scene => `<option value="${escapeHtml(scene.id)}">${escapeHtml(scene.name)}</option>`).join('');
  document.querySelector('#mode-label').textContent = preview ? '五幕設計預覽' : '暗渡 1941';
  if (query.has('invite')) online();
  else await show(location.hash.slice(1).replace('-', ':') || '3:25', { replace: true });
} catch (error) {
  notice.textContent = error.message;
}
