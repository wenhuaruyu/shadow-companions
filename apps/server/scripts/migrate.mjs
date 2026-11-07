import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

const repository = fileURLToPath(new URL("../../../", import.meta.url));

export async function runMigrations(pool) {
  const manifest = JSON.parse(
    await readFile(new URL("../db/migrations.json", import.meta.url), "utf8"),
  );
  // Read all files first. Missing source files must fail before database changes.
  const migrations = await Promise.all(
    manifest.map(async (entry) => {
      const sql = await readFile(resolve(repository, entry.file), "utf8");
      return {
        ...entry,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
  const connection = await pool.connect();
  const applied = [];
  try {
    await connection.query(
      "SELECT pg_advisory_lock(hashtext('anxian-schema-migrations'))",
    );
    await connection.query(`CREATE TABLE IF NOT EXISTS public.anxian_schema_migrations (
      id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await connection.query(
      "REVOKE ALL ON public.anxian_schema_migrations FROM PUBLIC",
    );
    for (const migration of migrations) {
      const result = await connection.query(
        "SELECT checksum FROM public.anxian_schema_migrations WHERE id=$1",
        [migration.id],
      );
      if (result.rows.length) {
        if (result.rows[0].checksum !== migration.checksum)
          throw new Error(`迁移校验不一致：${migration.id}`);
        continue;
      }
      // Legacy rpc.sql has its own outer transaction. The runner owns this boundary.
      const sql = migration.sql
        .replace(/^BEGIN;\s*/, "")
        .replace(/\bCOMMIT;\s*$/, "");
      await connection.query("BEGIN");
      try {
        await connection.query(sql);
        await connection.query(
          "INSERT INTO public.anxian_schema_migrations(id, checksum) VALUES ($1,$2)",
          [migration.id, migration.checksum],
        );
        await connection.query("COMMIT");
        applied.push(migration.id);
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await connection
      .query("SELECT pg_advisory_unlock(hashtext('anxian-schema-migrations'))")
      .catch(() => {});
    connection.release();
  }
  return applied;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[key]) throw new Error(`缺少迁移配置 ${key}`);
  }
  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === "true"
        ? {
            rejectUnauthorized: true,
            ...(process.env.DB_CA ? { ca: process.env.DB_CA } : {}),
          }
        : undefined,
  });
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length
        ? `已应用迁移：${applied.join(", ")}`
        : "数据库已是当前版本",
    );
  } finally {
    await pool.end();
  }
}
