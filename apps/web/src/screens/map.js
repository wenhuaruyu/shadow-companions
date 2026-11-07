export function renderMap({ panel, p, add, action }) {
  panel.innerHTML += "<p>信号已接通。请与同伴共同确认进入地点。</p>";
  add(p.entered ? "等待同伴进入…" : "进入地点 →", () =>
    action("enter"),
  ).disabled = p.entered;
}
