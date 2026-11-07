import { $, escapeHtml } from "../components/dom.js";

export function renderInvest({ panel, s, p, add, action, notice, draftKey }) {
  const need = [s.requirements.int, s.requirements.str];
  panel.innerHTML += `<h3>共同协商 · 分担投入</h3><p>任务需求 <b>智力 ${need[0]} / 武力 ${need[1]}</b></p>`;
  for (const x of s.players)
    panel.innerHTML += `<p class="ledger">${escapeHtml(x.name)}：${x.investment ? `已投入 智 ${x.investment.int} / 武 ${x.investment.str}` : "尚未确认"}</p>`;
  if (p.investment) panel.innerHTML += "<p>你的投入已扣除，等待同伴确认。</p>";
  else {
    panel.innerHTML += `<label>智力投入 <input id="int" type="number" min="0" max="${p.int}" value="${escapeHtml(sessionStorage.getItem(draftKey(s.chapter, "int")) || 0)}"></label><label>武力投入 <input id="str" type="number" min="0" max="${p.str}" value="${escapeHtml(sessionStorage.getItem(draftKey(s.chapter, "str")) || 0)}"></label><p class="fine">确认后不可撤销 · 超额不退 · 不足共同失败</p>`;
    for (const k of ["int", "str"])
      $("#" + k).oninput = (e) =>
        sessionStorage.setItem(draftKey(s.chapter, k), e.target.value);
    add("确认投入并扣除", () => {
      const values = { int: $("#int").value, str: $("#str").value };
      if (
        Object.values(values).some((x) => x === "") ||
        !["int", "str"].every(
          (k) =>
            Number.isInteger(Number(values[k])) &&
            Number(values[k]) >= 0 &&
            Number(values[k]) <= p[k],
        )
      )
        return notice("请输入余额以内的非负整数");
      if (
        confirm(
          `投入智力 ${values.int}、武力 ${values.str}，确认后实际扣除且不可撤销。继续？`,
        )
      )
        action("invest", {
          int: Number(values.int),
          str: Number(values.str),
        });
    });
  }
}
