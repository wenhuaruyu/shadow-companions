import './viewport.js';

if (!document.body.hasAttribute('data-landscape-display')) {
  // A web page cannot rotate iOS/WeChat itself. Require a landscape viewport
  // everywhere, including standalone games; use the native lock when available.
  const portrait = matchMedia('(orientation: portrait)');
  const gate = document.createElement('dialog');
  gate.className = 'landscape-gate';
  gate.setAttribute('aria-label', '请横屏游玩');
  gate.innerHTML = `<svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><rect x="10" y="25" width="60" height="34" rx="5"/><path d="M62 39v6M27 13a25 25 0 0 1 31 3M58 7v10H48"/></svg><p>请横屏游玩</p>`;
  const help = document.createElement('p');
  help.className = 'landscape-help';
  help.textContent = /MicroMessenger/i.test(navigator.userAgent)
    ? '请先开启手机自动旋转并横放手机。微信内仍无法横屏时，点右上角“…”选择“在浏览器打开”。'
    : '请开启手机自动旋转，再横放手机。';
  gate.append(help);
  if (document.documentElement.requestFullscreen && screen.orientation?.lock) {
    const start = document.createElement('button');
    start.type = 'button';
    start.textContent = '尝试横屏';
    start.onclick = async () => {
      start.disabled = true;
      try {
        await document.documentElement.requestFullscreen();
        await screen.orientation.lock('landscape');
      } catch {
        help.textContent = /MicroMessenger/i.test(navigator.userAgent)
          ? '微信未允许自动横屏，请点右上角“…”选择“在浏览器打开”，并开启手机自动旋转。'
          : '浏览器未允许自动横屏，请开启手机自动旋转，再横放手机。';
      } finally { start.disabled = false; }
    };
    gate.append(start);
  }
  document.body.append(gate);
  gate.addEventListener('cancel', event => event.preventDefault());
  function update() {
    if (portrait.matches && !gate.open) {
      gate.showModal();
      // Cancel held movement if orientation changes during a touch gesture.
      window.dispatchEvent(new Event('blur'));
    } else if (!portrait.matches && gate.open) gate.close();
  }
  if (portrait.addEventListener) portrait.addEventListener('change', update);
  else portrait.addListener(update);
  window.addEventListener('resize', update);
  update();
  let locking = false;
  function lock() {
    if (portrait.matches || locking || !screen.orientation?.lock) return;
    locking = true;
    screen.orientation.lock('landscape').catch(() => {
      // Native locking requires fullscreen in some browsers; the modal remains
      // the cross-browser enforcement mechanism, independent of native support.
      locking = false;
    });
  }
  window.addEventListener('pointerup', lock, { passive: true });
  document.addEventListener('fullscreenchange', lock);

}
