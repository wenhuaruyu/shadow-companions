export function renderEvent({ panel, s, add, action, renderAttempt }) {
  if (s.rulesVersion === "chapter-games-1" && s.cooperative && !s.attempt.done) return renderAttempt();
  if (!s.attempt && s.rulesVersion === "chapter-games-1") {
    panel.insertAdjacentHTML("beforeend", "<p>每人一次行动，选择本章小游戏。</p>");
    add("第一章智力游戏 · 名单调换调查", () => action("start", { type: "int" }));
    add("第一章武力游戏 · 后巷转移", () => action("start", { type: "str" }));
    return;
  }
  if (!s.attempt) {
    panel.innerHTML +=
      '<p>每人一次行动。选择你的分工，<br>为转移任务积累所需资源。</p><div class="event-card"><b>◇ 智力 · 核对联络笺</b><p>三道线索题 / 60秒 / 智力 +0～10</p></div>';
    add("开始智力事件", () => action("start", { type: "int" }));
    panel.insertAdjacentHTML(
      "beforeend",
      '<div class="event-card"><b>✦ 武力 · 掩护转移</b><p>十次通行信号 / 武力 +0～10</p></div>',
    );
    add("开始武力事件", () => action("start", { type: "str" }), "secondary");
  } else if (s.attempt.done)
    panel.innerHTML += `<div class="reward">+${s.attempt.reward}<small>${s.attempt.type === "int" ? "智力" : "武力"}已到账</small></div><p>线索与物资已整理一部分。等待同伴完成事件。</p>`;
  else renderAttempt();
}
