import { $, escapeHtml } from './dom.js';

export function renderPlayers(snapshot, role) {
  const host = $('#players');
  if (!snapshot || snapshot.phase === 'lobby' || (snapshot.phase === 'brief' && !role)) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = snapshot.players.map((player, seat) => {
    const mine = seat === snapshot.me;
    const character = role ? (mine === (role === 'courier') ? 'huang' : 'lin') : (seat ? 'lin' : 'huang');
    const name = character === 'huang' ? '黃慕蘭' : '林栩';
    return `<div class="player ${character} ${mine ? 'self' : ''}"><span class="avatar ${character}"><img src="/assets/figma/${character === 'huang' ? '33d0e.png' : '1adc6.png'}" alt="${name}"></span><div><b>${name}</b><small>智力 ${escapeHtml(player.int)}　武力 ${escapeHtml(player.str)}</small></div></div>`;
  }).join('');
}
