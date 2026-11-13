import { prologue, roleIntroductions } from '../content/figma-content.js';
import { dialogue } from '../components/scene.js';

export function renderBrief({ panel, p, ui, add, action, render, client, notice, saveRole }) {
  ui.prologue ??= 0;
  ui.instructionPage ??= 0;
  if (!p.instruction && ui.prologue < prologue.length) {
    dialogue(panel, prologue[ui.prologue]);
    if (ui.prologue > 0) add('上一頁', () => { ui.prologue--; render(); }, 'secondary');
    add('下一頁', () => { ui.prologue++; render(); });
    return;
  }
  if (!p.instruction) {
    if (!ui.privateText) {
      panel.innerHTML = '<p>請在自己的設備上閱讀人物身份與目標。</p>';
      add('查看人物分配', async () => {
        try {
          const instruction = await client.instruction();
          ui.privateText = instruction.text;
          saveRole(/另有秘密|軍統|军统/.test(instruction.text) ? 'secret' : 'courier');
          render();
        } catch (error) { notice(error.message); }
      });
      return;
    }
    const pages = roleIntroductions[ui.role];
    dialogue(panel, pages[ui.instructionPage]);
    if (ui.instructionPage > 0) add('上一頁', () => { ui.instructionPage--; render(); }, 'secondary');
    add(ui.instructionPage < pages.length - 1 ? '下一頁' : '我已記住', () => {
      if (ui.instructionPage < pages.length - 1) {
        ui.instructionPage++;
        render();
      } else {
        ui.privateText = null;
        action('instruction');
      }
    });
    return;
  }
  if (!p.tutorial) {
    panel.innerHTML = '<p>從發光的地點進入劇情，與同伴分擔行動。每個地點各有一次事件機會，完成度決定所得資源。</p>';
    add('進入地圖', () => action('tutorial'));
  } else panel.innerHTML = '<p>已就緒，等待同伴完成閱讀。</p>';
}
