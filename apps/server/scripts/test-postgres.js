import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { createServer } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "anxian-pg-test-"));
const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", resolve);
});
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const password = randomBytes(32).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: join(directory, "data"),
  user: "postgres",
  password,
  port,
  persistent: false,
  autoRehydrateSymlinks: true,
  postgresFlags: ["-h", "127.0.0.1", "-k", directory],
  onLog: () => {},
  onError: () => {},
});
let started = false;
try {
  await database.initialise();
  await database.start();
  started = true;
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const pool = new pg.Pool({ connectionString });
  try {
    await runMigrations(pool);
    const repeated = await runMigrations(pool);
    if (repeated.length) throw new Error("迁移重复执行不应新增记录");
  } finally {
    await pool.end();
  }
  console.log("临时 PostgreSQL 17.11 已启动，执行真实数据库验收");
  const tests = (await readdir(join(root, "apps/server/test")))
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => "apps/server/test/" + name);
  const child = spawn(
    process.execPath,
    ["--test", "--test-concurrency=1", ...tests],
    {
      cwd: root,
      env: { ...process.env, PG_TEST_URL: connectionString },
      stdio: "inherit",
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  if (started) await database.stop();
  await rm(directory, { recursive: true, force: true });
}
