# 暗线同行者 · Figma设计交付

设计文件：https://www.figma.com/design/CxjPDwymw9dsB720bgldgw

原型入口：https://www.figma.com/proto/CxjPDwymw9dsB720bgldgw?node-id=3-25

设计已包含开场渐显、四页序曲、双方准备后的人物介绍、五幕全屏地图、常驻双角色属性栏、地点内CG、底部统一对话框与右下角双向翻页。人物为黄慕兰与林栩，林栩私密介绍使用独立视角分支，序曲已使用场景CG。

共用对话框主组件为 `95:108`，人物介绍入口为 `30:170` 和 `99:341`，序曲入口为 `90:99`。以文件当前画板为视觉依据。

运行前端位于 `apps/web`，前端工作目录为 `.worktrees/frontend`。设计更新通过读取Figma后实现到源码，再验证、提交和推送。运行时使用的图片放在 `apps/web/public/assets`，设计源素材和生成记录存放在本目录。

当前设计预览中的联网状态与成绩为交互示例。真实联网入口使用v2接口确认阶段与资源。

## 2026-11-13 前端同步

当前五幕主线与状态页面已保存到 `apps/web/public/figma`，共174页。页面按钮保留原型跳转，46个CG先行节点通过前端显示状态处理。片头淡入播放一次后停留。前端入口由 `apps/web/index.html` 提供，联网入口位于 `apps/web/public/online.html`。
