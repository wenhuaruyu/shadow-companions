export function renderLobby({ panel, s, p, add, action, notice }) {
  panel.innerHTML +=
    "<h3>等待同伴，共同行动</h3><p>把邀请链接交给另一位交通员。<br>两人准备完成后，行动开始。</p>";
  const link = location.origin + location.pathname + "?invite=" + s.id;
  const input = document.createElement("input");
  input.value = link;
  input.readOnly = true;
  panel.append(input);
  add(
    "复制邀请链接",
    async () => {
      try {
        await navigator.clipboard.writeText(link);
        notice("邀请链接已复制");
      } catch {
        input.select();
        notice("请长按复制邀请链接");
      }
    },
    "secondary",
  );
  add(p.ready ? "取消准备" : "准备", () =>
    action("ready", { ready: !p.ready }),
  );
}
