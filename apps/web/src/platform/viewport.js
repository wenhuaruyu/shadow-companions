const root = document.documentElement;
const embedded = window !== window.top;
document.body.dataset.gameViewport = embedded ? 'embedded' : 'framed';
root.dataset.gameViewport = document.body.dataset.gameViewport;
if (!embedded) {
  const frame = document.createElement('div');
  frame.id = 'game-viewport-frame';
  frame.setAttribute('aria-hidden', 'true');
  document.body.append(frame);
}
let scheduled = false;
function measure() {
  scheduled = false;
  const viewport = embedded ? null : window.visualViewport;
  const width = viewport?.width || innerWidth;
  const height = viewport?.height || innerHeight;
  root.style.setProperty('--visible-left', `${viewport?.offsetLeft || 0}px`);
  root.style.setProperty('--visible-top', `${viewport?.offsetTop || 0}px`);
  root.style.setProperty('--visible-width', `${width}px`);
  root.style.setProperty('--visible-height', `${height}px`);
  window.dispatchEvent(new Event('gameviewportchange'));
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(measure);
}
window.addEventListener('resize', schedule);
window.addEventListener('orientationchange', schedule);
window.visualViewport?.addEventListener('resize', schedule);
window.visualViewport?.addEventListener('scroll', schedule);
measure();
