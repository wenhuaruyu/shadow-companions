import { notice } from "../components/dom.js";

export function renderHome({ panel, add, enter, resume, hasSession }) {
  panel.innerHTML =
    '<p class="eyebrow">一封未署名的信 · 一段共同的旅程</p><h2>夜色之下，<br>把希望送往下一站。</h2><p class="intro">两名交通员，一张联络网。<br>在动荡的城市里，与你的同伴<br>共同完成一场无声的转移。</p><div class="tags"><span>双人合作</span><span>横屏体验</span><span>历史改编</span></div>';
  const invite = new URLSearchParams(location.search).get("invite");
  add(invite ? "加入这次行动 →" : "开始双人游戏 →", async () => {
    if (hasSession) {
      notice("当前浏览器已有对局，请先继续或结束原对局。");
      return;
    }
    await enter(invite);
  });
  if (hasSession) add("继续当前对局", resume, "secondary");
  panel.insertAdjacentHTML(
    "beforeend",
    '<p class="fine">1941年冬 — 1942年初 · 香港<br>玩家角色与任务为虚构改编</p>',
  );
}
