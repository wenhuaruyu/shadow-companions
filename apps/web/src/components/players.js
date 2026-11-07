import { $, escapeHtml } from "./dom.js";

export function renderPlayers(snapshot) {
  $("#players").innerHTML = snapshot
    ? snapshot.players
        .map(
          (player, seat) => `
    <div class="player ${seat === snapshot.me ? "self" : ""}">
      <span class="avatar">${escapeHtml(player.name.slice(0, 1))}</span>
      <div><b>${escapeHtml(player.name)} ${seat === snapshot.me ? "<small>你</small>" : ""}</b>
      <small>${player.online ? "● 在线" : "○ 连接状态待确认"}</small></div>
      <div class="attributes">智 <b>${player.int}</b><br>武 <b>${player.str}</b></div>
    </div>`,
        )
        .join("")
    : "";
}
