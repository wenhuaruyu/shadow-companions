import { chapterScenes } from "./figma-content.js";
export const chapters = ["銅鑼灣 · 暗室中的名單", "紅磡碼頭 · 潮汐中的接應"];
export const stories = chapterScenes.map(scenes => scenes.map(scene => scene.text));
export const locations = [
  ["桂林", 16, 22],
  ["曲江 · 今韶关", 43, 18],
  ["惠阳 / 惠州", 77, 31],
  ["銅鑼灣聯絡寓所", 51, 83],
  ["紅磡碼頭", 78, 61],
];
