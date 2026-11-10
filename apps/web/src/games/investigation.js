import { game, suspects } from "./investigation-content.js";
import { escapeHtml } from "../components/dom.js";

const root = document.querySelector("#investigation");
const dialog = document.querySelector("#judgment");
const storageKey = "anxian.investigation.v1";
let progress = readProgress();
let activeId = null;
let feedback = "";

function readProgress() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.excluded) &&
        saved.excluded.every((id) => ["su", "mai"].includes(id)) &&
        new Set(saved.excluded).size === saved.excluded.length &&
        typeof saved.solved === "boolean") return {
          excluded: saved.excluded,
          solved: saved.solved,
          deadline: Number.isFinite(saved.deadline) && saved.deadline > 0 ? saved.deadline : null,
          expired: saved.expired === true,
        };
  } catch (error) {
    // Storage may be unavailable in private or embedded browsers.
    console.info("调查进度无法读取，将开始新一轮。", error.name);
  }
  return { excluded: [], solved: false, deadline: null, expired: false };
}

function saveProgress() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(progress));
  } catch (error) {
    feedback = "当前浏览器无法保存进度，请在本页完成调查。";
    console.info("调查进度无法保存。", error.name);
  }
}

function portrait(id) {
  const features = {
    su: '<circle cx="96" cy="36" r="13"/><path d="M45 65 Q36 17 75 22 Q106 22 105 69 L96 57 Q74 45 51 60Z"/>',
    mai: '<path d="M48 48 Q45 17 77 24 Q101 25 102 53 L94 46 Q74 32 53 50Z"/><path d="M70 109h10v-10h7v-8h-7v-9H70v9h-7v8h7Z" fill="#e7d4b2"/>',
    chen: '<path d="M40 45 Q43 23 74 23 Q105 23 108 45Z"/><path d="M34 46h82v9H34Z"/><path d="M56 67h14m12 0h14M70 67h12" stroke="#30251e" stroke-width="2" fill="none"/>',
  };
  return `<svg class="portrait" viewBox="0 0 150 150" aria-hidden="true"><path d="M26 150v-25q3-29 49-30 47 1 49 30v25Z" fill="currentColor"/><ellipse cx="75" cy="63" rx="27" ry="34" fill="#c4a27c"/><path d="M63 86q12 8 24 0" stroke="#705338" fill="none"/>${features[id]}</svg>`;
}

function header() {
  return `<header><div><p class="kicker">${game.label}</p><h1>${game.title}</h1></div><p class="status">${progress.solved ? "调查已完成" : progress.expired ? "调查时间已到" : progress.deadline ? `<span id="countdown" role="timer"></span> · 剩余判断 ${3 - progress.excluded.length} 次` : "准备调查"}</p></header>`;
}

function render() {
  if (expireIfNeeded()) return;
  root.innerHTML = header();
  if (progress.solved || progress.expired) return renderResult();
  if (!progress.deadline) return renderStart();
  updateCountdown();
  if (activeId) renderPerson();
  else renderPeople();
  const message = document.createElement("p");
  message.className = "feedback";
  message.setAttribute("role", "status");
  message.textContent = feedback;
  root.append(message);
}

function renderStart() {
  root.insertAdjacentHTML("beforeend", `<section class="paper intro"><h2>名单被调换，谁在说谎？</h2><p>查看三个人物的聊天与证据，在 90 秒内找出调换名单的人。</p><p>共有三次判断机会，第一次选对获 10 分，第二次 6 分，第三次 3 分。超时获得 0 分。</p><div class="actions"><button class="primary" id="start">开始判断案件</button></div></section>`);
  root.querySelector("#start").onclick = () => {
    progress.deadline = Date.now() + 90000;
    saveProgress();
    render();
  };
}

function expireIfNeeded() {
  if (!progress.deadline || progress.solved || progress.expired || Date.now() < progress.deadline) return false;
  progress.expired = true;
  if (dialog.open) dialog.close();
  saveProgress();
  render();
  return true;
}

function updateCountdown() {
  if (expireIfNeeded()) return;
  const timer = root.querySelector("#countdown");
  if (timer) timer.textContent = `${Math.max(0, Math.ceil((progress.deadline - Date.now()) / 1000))} 秒`;
}

function renderPeople() {
  root.insertAdjacentHTML("beforeend", `<section class="paper intro"><p>今晚七点半，联络处的名单被调换。接触过名单的三个人，如今各有一番说辞。</p><p>点击人物查看聊天与证据，找出调换名单的人。第一次选对获 10 分，第二次 6 分，第三次 3 分。</p></section><section class="people" aria-label="调查人物">${suspects.map((person) => `<div class="suspect"><button class="primary verdict" data-judge="${person.id}" ${progress.excluded.includes(person.id) ? "disabled" : ""}>${progress.excluded.includes(person.id) ? "已排除" : person.id === "su" ? "是她" : "是他"}</button><button class="person" data-person="${person.id}">${portrait(person.id)}<strong>${person.name}</strong><small>${person.role}</small><span class="stamp">${progress.excluded.includes(person.id) ? "已排除 · 可回看" : "查看聊天与证据"}</span></button></div>`).join("")}</section><p class="hint">证据可反复查看 · 点击“是他／是她”立即消耗一次机会</p>`);
  root.querySelectorAll("[data-judge]").forEach((button) => {
    button.onclick = () => judge(button.dataset.judge);
  });
  root.querySelectorAll("[data-person]").forEach((button) => {
    button.onclick = () => {
      activeId = button.dataset.person;
      feedback = "";
      render();
      root.querySelector(".detail-head h2").focus();
    };
  });
}

function renderPerson() {
  const person = suspects.find((candidate) => candidate.id === activeId);
  const excluded = progress.excluded.includes(person.id);
  root.insertAdjacentHTML("beforeend", `<section class="paper"><div class="detail-head"><div><h2 tabindex="-1">${person.name}</h2><span>${person.role}${excluded ? " · 已排除" : ""}</span></div><button id="back">返回三人</button></div><div class="details"><section><h3>聊天记录</h3><div class="conversation" tabindex="0" aria-label="聊天记录，可滚动">${person.dialogue.map((line) => `<div class="line"><strong>${line.speaker}</strong><p>${escapeHtml(line.text)}</p></div>`).join("")}</div></section><section><h3>相关证据</h3><div class="evidence">${person.evidence.map((card, index) => `<button data-evidence="${index}"><small>证据 ${index + 1} / 点击展开</small><b>${card.title}</b></button>`).join("")}</div></section></div><div class="actions"><button class="primary" id="accuse" ${excluded ? "disabled" : ""}>${excluded ? "此人已排除" : person.id === "su" ? "是她" : "是他"}</button></div></section>`);
  root.querySelector("#back").onclick = () => {
    activeId = null;
    render();
  };
  root.querySelectorAll("[data-evidence]").forEach((button) => {
    button.onclick = () => {
      const card = person.evidence[Number(button.dataset.evidence)];
      showDialog(card.title, `<p>${escapeHtml(card.text)}</p>`, "继续调查");
    };
  });
  root.querySelector("#accuse").onclick = () => {
    judge(person.id);
  };
}

function showDialog(title, body, closeLabel, confirmAction) {
  dialog.innerHTML = `<h2 id="judgment-title">${escapeHtml(title)}</h2>${body}<div class="actions"><button id="cancel">${closeLabel}</button>${confirmAction ? '<button class="primary" id="confirm">确认判断</button>' : ""}</div>`;
  dialog.querySelector("#cancel").onclick = () => dialog.close();
  if (confirmAction) dialog.querySelector("#confirm").onclick = () => {
    dialog.close();
    confirmAction();
  };
  dialog.showModal();
}

function judge(id) {
  if (expireIfNeeded() || !progress.deadline || progress.solved || progress.expired || progress.excluded.includes(id)) return;
  if (id === "chen") progress.solved = true;
  else {
    progress.excluded.push(id);
    activeId = null;
    feedback = "现有证据无法支持这一判断。请重新核对对话与证据。";
  }
  saveProgress();
  render();
}

function renderResult() {
  const score = progress.solved ? [10, 6, 3][progress.excluded.length] : 0;
  root.insertAdjacentHTML("beforeend", `<section class="paper"><div class="reward"><p class="kicker" style="color:#705b40">${progress.solved ? "调查完成" : "时间已到"}</p><h2>${progress.solved ? "名单的去向，终于有了答案" : "调查时间结束"}</h2><strong>+${score}</strong><p>智力奖励 · ${progress.solved ? `第 ${progress.excluded.length + 1} 次判断正确` : "90 秒内未完成判断"}</p></div><h3>调换名单的人是陈伯</h3><p>陈伯说自己只在门边放下食盒，却知道文件藏在第三格夹层。留条证明这个位置未曾公开，残纸也证实名单正是从那里被抽走的。</p><blockquote>“他们说，只要递过去几个名字，就放过我家里的人……我以为拿走那张纸，就不会再有人来问。”</blockquote><p>七点半时，苏曼云的查货记录有送货回执印证。麦神父交出的是赈济册，教堂值事也证明他当时留在教堂。</p><div class="actions"><button id="replay">重新试玩</button></div></section>`);
  root.querySelector("#replay").onclick = () => {
    showDialog("重新开始调查？", "<p>本轮判断记录将清空，重新获得三次判断机会。</p>", "保留结果", () => {
      progress = { excluded: [], solved: false, deadline: null, expired: false };
      activeId = null;
      feedback = "";
      saveProgress();
      render();
    });
  };
}

render();
setInterval(updateCountdown, 200);
document.addEventListener("visibilitychange", updateCountdown);
