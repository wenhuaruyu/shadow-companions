import { $, button, escapeHtml } from "../components/dom.js";
import { renderChapterMinigame, updateChapterMinigame } from "./chapter-minigame.js";
import { attemptElapsed } from "../state/snapshot.js";

export function renderMinigame({ snapshot, action, rerender, add }) {
  if (snapshot.attempt?.gameId) return renderChapterMinigame({ snapshot, action, rerender, add });
  const attempt = snapshot.attempt;
  const panel = $("#panel");
  panel.dataset.attempt = attempt.id;
  panel.insertAdjacentHTML("beforeend", '<div class="timer" id="timer"></div>');
  if (attempt.type === "int") {
    snapshot.questions.forEach((question, index) => {
      const card = document.createElement("div");
      card.className = "question";
      card.innerHTML = `<p>${index + 1}. ${escapeHtml(question.text)}</p>`;
      question.options.forEach((option, choice) => {
        card.append(
          button(
            option,
            async () => {
              const answers = [...attempt.answers];
              answers[index] = choice;
              await action("answers", { answers });
              panel.dataset.attempt = "";
              rerender();
            },
            attempt.answers[index] === choice ? "selected" : "option",
          ),
        );
      });
      panel.append(card);
    });
    add("提交答案", () => {
      if (confirm("确认提交？未作答按错误计分。")) action("finish");
    });
  } else {
    panel.insertAdjacentHTML(
      "beforeend",
      '<p>倒数后点击「通行」，警戒区误触会失去本次机会。</p><div class="zones" id="zones"></div>',
    );
    for (let zone = 0; zone < 3; zone++) {
      $("#zones").append(
        button(
          "警戒",
          () => {
            const time = attemptElapsed(snapshot);
            const opportunity = Math.floor((time - 3000) / 2000);
            if (
              opportunity < 0 ||
              opportunity >= 10 ||
              (time - 3000) % 2000 >= 1200
            )
              return;
            action("hit", { opportunity, zone });
          },
          "zone",
        ),
      );
    }
  }
  updateMinigame(snapshot);
}

export function updateMinigame(snapshot) {
  if (snapshot?.attempt?.gameId) return updateChapterMinigame(snapshot);
  const attempt = snapshot?.attempt;
  if (!attempt || attempt.done) return;
  const time = attemptElapsed(snapshot);
  const timer = $("#timer");
  if (timer)
    timer.textContent = `${Math.max(0, Math.ceil((attempt.duration - time) / 1000))} 秒 · ${snapshot.paused ? "已暂停" : attempt.type === "int" ? "核对联络线索" : `命中 ${attempt.hits} / 10`}`;
  if (attempt.type !== "str") return;
  const index = Math.floor((time - 3000) / 2000);
  const active =
    time >= 3000 &&
    index < 10 &&
    (time - 3000) % 2000 < 1200 &&
    !attempt.used.includes(index);
  document.querySelectorAll(".zone").forEach((element, zone) => {
    const on = active && attempt.sequence[index] === zone;
    element.classList.toggle("go", on);
    element.textContent =
      time < 3000
        ? String(Math.ceil((3000 - time) / 1000))
        : on
          ? "● 通行"
          : "× 警戒";
    element.disabled = snapshot.paused;
  });
}
