import { stories } from "../content/locations.js";

export function renderStory({
  panel,
  s,
  p,
  ui,
  add,
  action,
  render,
  saveStory,
}) {
  ui.story = Math.min(ui.story, 3);
  panel.innerHTML += `<div class="story"><span>行动札记 / ${ui.story + 1} OF 4</span><p>${stories[s.chapter][ui.story]}</p></div>`;
  add(
    p.read
      ? "已读完，等待同伴"
      : ui.story < 3
        ? "下一段 →"
        : "已读完，开始准备",
    () => {
      if (ui.story < 3) {
        ui.story++;
        saveStory(ui.story);
        render();
      } else action("read");
    },
  ).disabled = p.read;
}
