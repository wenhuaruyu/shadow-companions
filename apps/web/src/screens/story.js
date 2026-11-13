import { chapterScenes } from "../content/figma-content.js";
import { dialogue } from "../components/scene.js";

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
  const scenes = chapterScenes[s.chapter] || chapterScenes[0];
  ui.story = Math.min(ui.story, scenes.length - 1);
  dialogue(panel, scenes[ui.story]);
  if (ui.story > 0) add("上一頁", () => {
    saveStory(--ui.story);
    render();
  }, "secondary");
  add(
    p.read
      ? "已读完，等待同伴"
      : ui.story < scenes.length - 1
        ? "下一段 →"
        : "已读完，开始准备",
    () => {
      if (ui.story < scenes.length - 1) {
        ui.story++;
        saveStory(ui.story);
        render();
      } else action("read");
    },
  ).disabled = p.read;
}
