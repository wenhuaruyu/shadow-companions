import { $, button, notice, modal } from "./components/dom.js";
import { renderMap } from "./components/map.js";
import { renderPlayers } from "./components/players.js";
import { chapters, stories } from "./content/locations.js";
import { createApiClient } from "./api/client.js";
import { readSession, saveSession } from "./state/storage.js";
import { applySnapshot, attemptElapsed } from "./state/snapshot.js";
import { renderHome } from "./screens/home.js";
import { renderLobby } from "./screens/lobby.js";
import { renderBrief } from "./screens/brief.js";
import { renderMap as renderMapScreen } from "./screens/map.js";
import { renderStory } from "./screens/story.js";
import { renderEvent } from "./screens/event.js";
import { renderInvest } from "./screens/invest.js";
import { renderResult } from "./screens/result.js";
import { renderEnded } from "./screens/ended.js";
import { renderMinigame, updateMinigame } from "./screens/minigame.js";

export function startGame() {
  let credential = readSession(localStorage);
  let state = null;
  let busy = false;
  let polling = false;
  let lastView = "";
  let expiryRefreshFor = null;
  const ui = { story: 0, tutorial: 0, review: null, privateText: null };
  const client = createApiClient({
    storage: localStorage,
    getSession: () => credential,
    getSnapshot: () => state,
  });
  const screens = {
    lobby: renderLobby,
    brief: renderBrief,
    map: renderMapScreen,
    story: renderStory,
    event: renderEvent,
    invest: renderInvest,
    result: renderResult,
  };
  const panel = $("#panel");
  const draftKey = (chapter, field) =>
    `anxian.draft.${credential?.id}.${chapter}.${field}`;
  const storyKey = () => `anxian.story.${credential?.id}.${state?.chapter}`;

  function saveStory(value) {
    ui.story = value;
    sessionStorage.setItem(storyKey(), String(value));
  }

  function clearSession() {
    credential = null;
    state = null;
    lastView = "";
    saveSession(localStorage, null);
  }

  function add(label, callback, className = "") {
    const element = button(label, callback, className);
    panel.append(element);
    return element;
  }

  function accept(response) {
    const previousScope = state ? `${state.id}.${state.chapter}` : null;
    state = applySnapshot(state, response);
    if (!state) return;
    if (previousScope !== `${state.id}.${state.chapter}`) {
      const position = Number(sessionStorage.getItem(storyKey()) || 0);
      ui.story = Number.isInteger(position)
        ? Math.max(0, Math.min(3, position))
        : 0;
      ui.review = null;
    }
    const view = JSON.stringify({
      ...state,
      receivedAt: 0,
      attempt: state.attempt ? { ...state.attempt, elapsed: 0 } : null,
    });
    if (view !== lastView) {
      lastView = view;
      render();
    } else updateMinigame(state);
  }

  async function action(kind, data = {}) {
    if (busy) return;
    busy = true;
    notice("处理中…");
    try {
      accept(await client.action(kind, data));
      notice("");
    } catch (error) {
      render();
      notice(error.message);
      const pending = client.pending();
      if (pending)
        $("#notice").append(
          button("重试上次操作", () => action(pending.kind, pending.data)),
        );
      if (error.code === "VERSION_CONFLICT") await poll(true);
    } finally {
      busy = false;
    }
  }

  async function enter(invite) {
    if (busy) return;
    busy = true;
    try {
      const result = invite ? await client.join(invite) : await client.create();
      credential = result.session;
      history.replaceState(null, "", "/");
      accept(result);
    } catch (error) {
      notice(error.message);
    } finally {
      busy = false;
    }
  }

  function render() {
    renderMap({ state, ui, render, action });
    renderPlayers(state);
    if (
      state?.phase === "event" &&
      state.attempt &&
      !state.attempt.done &&
      panel.dataset.attempt === state.attempt.id
    ) {
      updateMinigame(state);
      return;
    }
    // A private instruction stays local during public-state polling.
    if (
      ui.privateText &&
      state?.phase === "brief" &&
      !state.players[state.me].instruction
    )
      return;
    panel.dataset.attempt = "";
    panel.innerHTML = "";
    if (!state) {
      renderHome({
        panel,
        add,
        enter,
        hasSession: Boolean(credential),
        resume: () => poll(true),
      });
      return;
    }
    const s = state;
    const p = s.players[s.me];
    panel.innerHTML = `<p class="eyebrow">${s.chapter ? "CHAPTER II / 第二章" : "CHAPTER I / 第一章"}</p><h2>${chapters[s.chapter]}</h2>`;
    if (s.paused) {
      panel.insertAdjacentHTML(
        "beforeend",
        '<div class="pause">当前对局已暂停，请双方回到前台确认继续。</div>',
      );
      add("确认恢复行动", () => action("resume"));
      return;
    }
    if (ui.review !== null) {
      const record = s.records.find((item) => item.chapter === ui.review);
      panel.insertAdjacentHTML(
        "beforeend",
        `<h3>行动回看</h3><p>${stories[ui.review].join("</p><p>")}</p><p>${record ? `合计投入：智力 ${record.sums.int} / 武力 ${record.sums.str} · ${record.success ? "成功" : "不足"}` : "尚无行动记录"}</p>`,
      );
      add(
        "返回当前行动",
        () => {
          ui.review = null;
          render();
        },
        "secondary",
      );
      return;
    }
    const context = {
      panel,
      s,
      p,
      ui,
      add,
      action,
      render,
      client,
      notice,
      saveStory,
      draftKey,
      clearSession,
      renderAttempt: () =>
        renderMinigame({ snapshot: state, action, rerender: render, add }),
    };
    (screens[s.phase] || renderEnded)(context);
    const pending = client.pending();
    if (pending)
      add(
        "重试上次操作",
        () => action(pending.kind, pending.data),
        "secondary",
      );
    if (!s.ended)
      add(
        "退出当前对局",
        () => {
          if (confirm("退出将结束双方当前行动，确定？"))
            action("exit", { confirmed: true });
        },
        "text-btn",
      );
  }

  async function poll(force = false) {
    if (!credential || polling || document.hidden) return;
    polling = true;
    try {
      accept(await client.state(force));
    } catch (error) {
      notice(`连接异常：${error.message}`);
      if (
        ["INVALID_CREDENTIAL", "ROOM_NOT_FOUND", "ROOM_ENDED"].includes(
          error.code,
        )
      ) {
        $("#notice").append(
          button("清除本机凭证，返回开始", () => {
            if (confirm("清除后无法从此浏览器恢复原座位，确定？")) {
              clearSession();
              notice("");
              render();
            }
          }),
        );
      }
    } finally {
      polling = false;
    }
  }

  $("#close-modal").onclick = () => $("#modal").close();
  $("#help").onclick = () =>
    modal(
      "从地图进入地点，每人一次事件获得智力或武力。协商投入后实际扣除，超额不退，不足共同失败。\n\n以历史营救网络为背景，玩家角色、对话、任务与失败分支为虚构改编。",
    );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll(true);
  });
  render();
  if (credential && !new URLSearchParams(location.search).has("invite"))
    poll(true);
  setInterval(() => poll(), 1000);
  setInterval(() => {
    updateMinigame(state);
    if (
      !busy &&
      state?.attempt &&
      !state.attempt.done &&
      !state.paused &&
      expiryRefreshFor !== state.attempt.id &&
      attemptElapsed(state) >= state.attempt.duration
    ) {
      expiryRefreshFor = state.attempt.id;
      poll(true);
    }
  }, 50);
}
