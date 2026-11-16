export function connectGame(update) {
  let busy = false;
  let lastAction = null;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === 'anxian-game-error') {
      busy = false;
      let message = document.querySelector('#network-error');
      if (!message) { message = document.createElement('p'); message.id = 'network-error'; message.setAttribute('role', 'alert'); document.body.append(message); }
      message.textContent = event.data.message;
      if (lastAction) {
        const retry = document.createElement('button'); retry.textContent = '重试';
        retry.onclick = () => { busy = true; parent.postMessage(lastAction, location.origin); message.remove(); };
        message.append(retry);
      }
      return;
    }
    if (event.data?.type !== 'anxian-game-state') return;
    busy = false;
    update(event.data.snapshot);
  });
  parent.postMessage({ type: 'anxian-game-ready' }, location.origin);
  return { action(kind, data = {}) {
    if (busy) return;
    busy = true;
    document.querySelector('#network-error')?.remove();
    lastAction = { type: 'anxian-game-action', kind, data };
    parent.postMessage(lastAction, location.origin);
  } };
}

// Tea games can generate several inputs while an earlier HTTP request is in flight.
export function connectQueuedGame(update) {
  const queue = [];
  let current = null;
  function flush() {
    if (current || !queue.length) return;
    current = queue.shift();
    parent.postMessage(current, location.origin);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === 'anxian-game-state') update(event.data.snapshot);
    if (event.data?.type === 'anxian-game-ack' && event.data.actionId === current?.actionId) {
      current = null;
      flush();
    }
    if (event.data?.type === 'anxian-game-error') {
      let error = document.querySelector('#network-error');
      if (!error) { error = document.createElement('p'); error.id = 'network-error'; error.setAttribute('role', 'alert'); document.body.append(error); }
      error.textContent = event.data.message;
    }
  });
  parent.postMessage({ type: 'anxian-game-ready' }, location.origin);
  return { action(kind, data = {}) {
    queue.push({ type: 'anxian-game-action', actionId: crypto.randomUUID(), kind, data });
    flush();
  } };
}
