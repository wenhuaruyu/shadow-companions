# 暗线同行者

## 当前 Figma 前端同步

2026-11-13 同步了「暗渡 1941」五幕设计，共174张页面。首页、序曲、角色介绍、全屏地图、高清立绘、铜绿对话框与结局已保存到本地前端。

- `/` 显示片头，开始按钮进入真实双人联网入口。
- `/?preview=1` 提供五幕设计预览，可通过原型按钮和顶部场景选择器查看全部页面。示例准备状态、属性和事件结果来自设计稿。
- `/online.html` 使用现有v2接口创建、加入及恢复真实对局，同步现有前两处地点的最新剧情和对话框样式。
- 独立小游戏沿用 `/games/investigation.html` 和 `/games/cooperative.html`。

页面数据位于 `apps/web/public/figma/manifest.json`。每页由文本、图片和独立HTML图层组成，素材与中文字体位于 `apps/web/public/assets/figma`。`apps/web/src/styles/figma.css` 是设计导入时生成的CSS，运行和构建沿用项目原生HTML/CSS/JavaScript。

五幕完整联网状态机、后续资源投入与结局判定仍需后端接入。真实对局的阶段和资源由现有服务端确认。开发启动方式见下文。

双人横屏历史题材合作网页游戏，以黄慕兰寓所和铜锣湾避风塘为两处主要场景。

## 目录与并行开发

| 路径 | 职责 |
| --- | --- |
| `apps/web/src/api` | v2接口、恢复凭证、请求去重编号与错误处理 |
| `apps/web/src/state` | 本人会话、快照版本和有效计时插值 |
| `apps/web/src/components` | 地图、玩家状态和公共DOM组件 |
| `apps/web/src/screens` | 开始、准备、剧情、小游戏、投入与结算页面 |
| `apps/web/src/content` | 公开地点与剧情，正确答案和私密指令由服务端下发 |
| `apps/web/src/styles` | 前端样式 |
| `apps/web/public/assets` | 运行时图片、字体与声音 |
| `apps/server/legacy-web` | 旧协议演示网页，仅由legacy入口提供 |
| `apps/server/src/v2` | 当前开发的业务服务，支持原生PostgreSQL或HTTP RPC存储 |
| `apps/server/db` | 数据库迁移顺序与执行说明 |
| `contracts` | 接口约定、状态规则和响应样例 |
| `design` | Figma链接、设计源素材与插画说明 |

前端专用工作目录为 `.worktrees/frontend`，分支为 `codex/frontend`。后端在主工作目录开发。worktree共享Git历史，各自拥有独立工作文件、索引和分支。前端按契约接入，接口变更应同步确认后提交。每个工作目录单独安装依赖并配置自己的 `.env`。

## 安装与启动

使用Node.js 24，执行 `npm ci`。复制 `.env.example` 为 `.env`，填写当前开发模式需要的配置。启动命令会读取项目根目录 `.env`。

```sh
# 后端终端
npm run dev:server

# 前端终端，可在前端worktree运行
npm run dev:web
```

前端位于 `http://localhost:5173`。浏览器统一请求同源 `/api`，开发服务器将其代理到 `API_TARGET`，默认 `http://127.0.0.1:3000`。后端可以来自另一个工作目录或指定测试服务。真实手机访问时配置 `WEB_HOST=0.0.0.0`，并分享电脑局域网IP的5173端口地址。邀请链接由当前前端地址生成。

`STORAGE_MODE=pg` 使用 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`，并设置 `PUBLIC_ORIGIN`。新测试数据库先执行 `npm run db:migrate`。已有数据库的接入限制及迁移顺序见 `apps/server/db/README.md`。

`STORAGE_MODE=rpc` 使用 `RPC_ENDPOINT/RPC_SERVICE_TOKEN/PUBLIC_ORIGIN`。数据库凭证、RPC服务密钥只放在后端环境，前端仅持有本人的对局恢复凭证。健康检查为 `/api/health`。

`npm start` 启动v2 API服务，与Docker入口保持一致。旧版文件存档演示通过 `npm run start:legacy` 或 `npm run dev:legacy` 启动。旧版与v2使用不同协议和浏览器会话，v2前端应连接v2后端。

## 构建与验证

```sh
npm run check
npm test
npm run build
npm run test:db
```

`check`递归检查应用与脚本的JavaScript语法。`test`包含前端请求重试、版本保护、代理与后端测试，未配置 `PG_TEST_URL` 时真实数据库用例会跳过。`test:db`启动临时PostgreSQL、应用同一迁移清单并运行真实数据库用例，随后清理。CI执行上述四项检查。

前端静态产物位于 `apps/web/dist`，该目录由构建生成并被Git忽略。正式部署需分别提供静态网页与API，同域 `/api` 由网关转发。当前服务端Docker镜像提供API，不包含网页静态产物。Node版本与依赖锁文件应在前后端分支保持一致。

## 当前完成度

前端已按v2契约发送协议版本、请求编号、明确的准备值、预期状态版本、尝试编号及输入序号，并读取 `snapshot`。创建/加入请求在发送前持久保存恢复秘密；网络重试沿用原编号和参数；较旧的状态响应不会覆盖当前状态。页面按已确认计时锚点更新小游戏，无须逐帧轮询服务端。

后端工作目录正在实现v2玩法。目前已支持创建、加入、准备、个人指令、教学、共同进入和剧情已读，可推进到event。`start/answers/hit/finish/abandon/presence/resume/draft/invest/continue/exit` 仍需后端完成并进行双端联调。前端可以按契约发送这些动作，但完整两地点联网闭环尚未验收。原型中的最新美术、序曲和统一底部对话框也尚待完整移植到运行页面。

Figma设计文件见 `design/FIGMA.md`。设计稿、可点击原型、运行前端与后端验收分别记录。当前仍需真实双手机兼容检查、两轮完整试玩和正式部署验收。
