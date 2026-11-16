import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { runMigrations } from '../apps/server/scripts/migrate.mjs';
import { GameplayService } from '../apps/server/src/v2/gameplay.js';
import { RoomService } from '../apps/server/src/v2/rooms.js';
import { createRoomServer } from '../apps/server/src/v2/server.js';
import { createWebServer } from '../apps/web/dev-server.mjs';

const webPort = Number(process.env.LOCAL_WEB_PORT || 5210);
const apiPort = Number(process.env.LOCAL_API_PORT || 3210);
const directory = await mkdtemp(join(tmpdir(), 'shadow-local-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const databasePort = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const password = randomBytes(32).toString('hex');
const database = new EmbeddedPostgres({ databaseDir: join(directory, 'data'), user: 'postgres', password, port: databasePort,
  persistent: false, autoRehydrateSymlinks: true, postgresFlags: ['-h', '127.0.0.1', '-k', directory], onLog() {}, onError() {} });
await database.initialise();
await database.start();
const pool = new pg.Pool({ host: '127.0.0.1', port: databasePort, user: 'postgres', password, database: 'postgres' });
await runMigrations(pool);
const api = createRoomServer(pool, `http://localhost:${webPort}`);
const web = createWebServer({ apiTarget: `http://127.0.0.1:${apiPort}` });
await new Promise(resolve => api.listen(apiPort, '127.0.0.1', resolve));
await new Promise(resolve => web.listen(webPort, '127.0.0.1', resolve));
// A second local entry starts fresh test rooms at chapter three.
class ThirdChapterPreview extends GameplayService {
  constructor(rooms, chapter = 2) { super(rooms); this.chapter = chapter; }
  async enter(body, joining = false) {
    const result = await super.enter(body, joining);
    if (!joining) {
      const document = await this.rooms.loadGame(result.id, body.recoverySecret);
      if (!document.state.localThirdChapter) {
        document.state.chapter = this.chapter;
        document.state.localThirdChapter = true;
        await this.rooms.commitGame(document, body.recoverySecret, []);
      }
      result.snapshot = await this.state(result.id, body.recoverySecret);
    }
    return result;
  }
}
const thirdWebPort = webPort + 1;
const thirdApiPort = apiPort + 1;
const thirdApi = createRoomServer(pool, `http://localhost:${thirdWebPort}`, new ThirdChapterPreview(new RoomService(pool, `http://localhost:${thirdWebPort}`)));
const thirdWeb = createWebServer({ apiTarget: `http://127.0.0.1:${thirdApiPort}`, entryQuery: 'chapter3' });
await new Promise(resolve => thirdApi.listen(thirdApiPort, '127.0.0.1', resolve));
await new Promise(resolve => thirdWeb.listen(thirdWebPort, '127.0.0.1', resolve));
const fourthWebPort = webPort + 2;
const fourthApiPort = apiPort + 2;
const fourthApi = createRoomServer(pool, `http://localhost:${fourthWebPort}`, new ThirdChapterPreview(new RoomService(pool, `http://localhost:${fourthWebPort}`), 3));
const fourthWeb = createWebServer({ apiTarget: `http://127.0.0.1:${fourthApiPort}`, entryQuery: 'chapter4' });
await new Promise(resolve => fourthApi.listen(fourthApiPort, '127.0.0.1', resolve));
await new Promise(resolve => fourthWeb.listen(fourthWebPort, '127.0.0.1', resolve));
console.log(`第四章联调入口 http://localhost:${fourthWebPort}/online.html?chapter4=1`);
console.log(`第三章联调入口 http://localhost:${thirdWebPort}/online.html`);
console.log(`本地完整游戏 http://localhost:${webPort}/online.html`);
console.log('独立临时 PostgreSQL 已就绪，停止本进程后清理测试数据。');
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  await Promise.all([api, web, thirdApi, thirdWeb, fourthApi, fourthWeb].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
  await pool.end(); await database.stop(); await rm(directory, { recursive: true, force: true }); process.exit(0);
});
