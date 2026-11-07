import { escapeHtml } from "../components/dom.js";

export function renderBrief({
  panel,
  p,
  ui,
  add,
  action,
  render,
  client,
  notice,
}) {
  if (!p.instruction) {
    panel.innerHTML +=
      "<h3>你的个人指令</h3><p>请在自己的设备上阅读并牢记。</p>";
    add("查看个人指令", async () => {
      try {
        const d = await client.instruction();
        ui.privateText = d.text;
        panel.innerHTML =
          '<p class="eyebrow">仅本人可见 / 阅后收起</p><h2>个人指令</h2><p>' +
          escapeHtml(ui.privateText) +
          "</p>";
        add("我已记住", () => {
          ui.privateText = null;
          action("instruction");
        });
      } catch (e) {
        notice(e.message);
      }
    });
  } else if (!p.tutorial) {
    const titles = ["从地图进入地点", "每人一次事件", "投入会实际扣除"];
    panel.innerHTML += `<h3>${titles[ui.tutorial]}</h3><div class="tutorial-number">0${ui.tutorial + 1}</div><p>${["共同确认进入当前地点，阅读开场剧情。五处网络节点，本次开放前两处。", "选择智力解谜或武力反应，完成度决定奖励。每人每地点仅有一次机会。", "原有智力8，投入3，剩余5。与同伴分担两项需求；超额不退，不足会共同失败。"][ui.tutorial]}</p><small>${ui.tutorial + 1} / 3</small>`;
    if (ui.tutorial)
      add(
        "上一页",
        () => {
          ui.tutorial--;
          render();
        },
        "secondary",
      );
    add(ui.tutorial < 2 ? "下一页" : "了解，开始行动", () => {
      if (ui.tutorial < 2) {
        ui.tutorial++;
        render();
      } else action("tutorial");
    });
  } else panel.innerHTML += "<p>已就绪，等待同伴完成阅读…</p>";
}
