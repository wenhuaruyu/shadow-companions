import { $, button, modal } from "./dom.js";
import { locations } from "../content/locations.js";

const designMaps = new Map();
let requestedMap = null;

export function renderMap({ state, ui, render, action }) {
  const players = $('#players');
  players.hidden = state?.phase === 'map';
  if (state?.phase === 'map') {
    renderDesignMap({ state, action });
    return;
  }
  requestedMap = null;

  const el = $("#locations");
  el.innerHTML = "";
  locations.forEach(([name, x, y], i) => {
    const ch = i - 3;
    const current = state && ch === state.chapter;
    const done = state?.records.some((r) => r.chapter === ch && r.success);
    const b = button(
      "",
      () => {
        if (ch < 0) return modal("本次体验暂未开放");
        if (!state)
          return modal(
            ch === 0
              ? "开始双人游戏，与同伴进入第一章。"
              : "完成黄慕兰寓所后开放",
          );
        if (ch > state.chapter) return modal("请先完成黄慕兰寓所");
        if (ch < state.chapter) {
          ui.review = ch;
          render();
        } else {
          ui.review = null;
          render();
        }
      },
      "location " + (current ? "current" : "") + (done ? " done" : ""),
    );
    if (current && state.phase === 'map') b.onclick = () => {
      if (!state.players[state.me].entered) action('enter');
      else modal('已確認進入，等待同伴。');
    };
    b.style.left = x + "%";
    b.style.top = y + "%";
    b.innerHTML = `<span class="pin">${done ? "✓" : ch >= 0 ? "0" + (ch + 1) : "◇"}</span><b>${name}</b><small>${done ? "已完成 · 可回看" : current ? "当前行动" : ch < 0 ? "后续内容" : ch === 0 ? "第一章" : "完成前章后开放"}</small>`;
    el.append(b);
  });
}

async function renderDesignMap({ state, action }) {
  const scene = state.chapter === 0 ? '3-471' : '3-1906';
  const request = { room: state.id, version: state.version, scene };
  requestedMap = request;
  const host = $('#locations');
  host.style.position = 'absolute';
  host.style.inset = '0';
  try {
    if (!designMaps.has(scene)) {
      const response = await fetch(`/figma/scenes/${scene}.html`);
      if (!response.ok) throw new Error('地图设计加载失败');
      designMaps.set(scene, await response.text());
    }
    if (requestedMap !== request) return;
    host.innerHTML = designMaps.get(scene);
    host.firstElementChild.style.pointerEvents = 'none';
    const attributes = [...host.querySelectorAll('p')].filter(node => /智力\s*5\s*武力\s*5/.test(node.textContent));
    attributes.forEach((node, seat) => {
      const player = state.players[seat];
      if (player) node.textContent = `智力 ${player.int}    武力 ${player.str}`;
    });
    for (const control of host.querySelectorAll('button')) {
      control.style.pointerEvents = 'auto';
      const name = control.dataset.name || '';
      control.setAttribute('aria-label', name);
      const chapter = /銅鑼灣|铜锣湾/.test(name) ? 0 : /紅磡|红磡/.test(name) ? 1 : -1;
      control.onclick = () => {
        if (chapter !== state.chapter) return modal('请先完成当前地点的行动。');
        if (state.players[state.me].entered) return modal('已确认进入，等待同伴。');
        action('enter');
      };
    }
  } catch (error) {
    if (requestedMap === request) host.textContent = error.message;
  }
}
