export function renderEnded({ panel, s, ui, add, render, clearSession }) {
  panel.innerHTML += `<h3>${s.phase === "complete" ? "两地体验完成" : s.phase === "failed" ? "行动中断" : "行动已结束"}</h3><p>${s.phase === "complete" ? "前方还有惠阳、曲江与桂林的消息。本次体验到此结束，故事仍在继续。" : s.reason || "安全窗口已经关闭，请重新配合。"}</p>`;
  s.records.forEach((r) =>
    add(
      `回看第${r.chapter + 1}章 · ${r.success ? "成功" : "失败"}`,
      () => {
        ui.review = r.chapter;
        render();
      },
      "secondary",
    ),
  );
  add("返回开始界面", () => {
    clearSession();
    render();
  });
}
