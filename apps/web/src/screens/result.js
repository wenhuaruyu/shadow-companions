export function renderResult({ panel, s, p, ui, add, action, saveStory }) {
  const r = s.records.at(-1);
  panel.innerHTML += `<p class="eyebrow">行动结算</p><h3>${r.success ? "联络已接续" : "错过安全窗口"}</h3><p>合计投入：智力 ${r.sums.int} / 武力 ${r.sums.str}</p><p>${r.success ? (s.chapter ? "最后一只行李被递上船。岸上的联络人收起手势，你们完成了这段转移任务。" : "联络资料和随身物资已完成整理。一段时间后，新的指令送达：前往铜锣湾避风塘。") : "准备未能衔接，本次行动中断。史实中的营救仍由其他交通线继续。"}</p>`;
  add(p.continued ? "等待同伴…" : r.success ? "继续 →" : "查看行动结束", () => {
    ui.story = 0;
    saveStory(0);
    action("continue");
  }).disabled = p.continued;
}
