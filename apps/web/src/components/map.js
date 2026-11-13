import { $, button, modal } from "./dom.js";
import { locations } from "../content/locations.js";

export function renderMap({ state, ui, render, action }) {
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
