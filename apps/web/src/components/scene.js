import { escapeHtml } from "./dom.js";

const artCache = new Map();
let requestedScene;

export async function showScene(id) {
  const host = document.querySelector("#scene-art");
  if (!host || requestedScene === id) return;
  requestedScene = id;
  try {
    if (!artCache.has(id)) {
      const response = await fetch(
        "/figma/art/" + id.replace(":", "-") + ".html",
      );
      if (!response.ok) throw new Error("CG載入失敗");
      artCache.set(id, await response.text());
    }
    if (requestedScene === id) host.innerHTML = artCache.get(id);
  } catch {
    if (requestedScene === id) host.innerHTML = "";
  }
}

export function dialogue(panel, scene) {
  panel.dataset.speaker = scene.speaker || "";
  panel.innerHTML = `<p class="dialogue-title">${escapeHtml(scene.title)}</p><p class="dialogue-body">${escapeHtml(scene.text)}</p>`;
  showScene(scene.id);
}

export function resizeGame() {
  document.documentElement.style.setProperty(
    "--canvas-scale",
    Math.min(innerWidth / 844, innerHeight / 390),
  );
}
