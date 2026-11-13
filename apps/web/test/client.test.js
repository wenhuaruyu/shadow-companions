import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { applySnapshot, attemptElapsed } from "../src/state/snapshot.js";
import {
  newRecoverySecret,
  newRequestId,
  readSession,
} from "../src/state/storage.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const session = { id: "room-id", token: "owner-token" };
const snapshot = { id: "room-id", version: 3, phase: "lobby", chapter: 0 };

test("创建响应丢失后沿用原编号和恢复秘密", async () => {
  const store = storage();
  const requests = [];
  let calls = 0;
  const client = createApiClient({
    storage: store,
    getSession: () => null,
    getSnapshot: () => null,
    fetcher: async (_, options) => {
      requests.push(JSON.parse(options.body));
      if (++calls === 1) throw new Error("connection lost");
      return Response.json({
        id: "room-id",
        token: requests[0].recoverySecret,
        seat: 0,
      });
    },
  });
  await assert.rejects(client.create(), /连接失败/);
  const result = await client.create();
  assert.deepEqual(requests[1], requests[0]);
  assert.match(result.session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(readSession(store), result.session);
});

test("写请求重试保留版本和编号，明确错误后允许重新提交", async () => {
  const store = storage();
  const requests = [];
  let calls = 0;
  const client = createApiClient({
    storage: store,
    getSession: () => session,
    getSnapshot: () => snapshot,
    fetcher: async (_, options) => {
      assert.equal(options.headers["X-Contract-Version"], "2");
      assert.equal(options.headers.Authorization, "Bearer owner-token");
      requests.push(JSON.parse(options.body));
      calls++;
      if (calls === 1) throw new Error("connection lost");
      if (calls === 3)
        return Response.json(
          { code: "VERSION_CONFLICT", message: "版本冲突" },
          { status: 409 },
        );
      return Response.json({ snapshot });
    },
  });
  await assert.rejects(client.action("ready", { ready: true }), /连接失败/);
  await assert.rejects(client.action("exit", { confirmed: true }), /上次操作/);
  await client.action("ready", { ready: true });
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(client.pending(), null);
  await assert.rejects(client.action("ready", { ready: false }), /版本冲突/);
  await client.action("ready", { ready: false });
  assert.notEqual(requests[3].requestId, requests[2].requestId);
});

test("旧响应不会倒退状态，计时按快照锚点插值", () => {
  const current = { ...snapshot, version: 5 };
  assert.equal(
    applySnapshot(current, { snapshot: { ...snapshot, version: 4 } }),
    current,
  );
  assert.equal(applySnapshot(current, { changed: false }), current);
  const active = {
    attempt: { elapsed: 1000, duration: 60000 },
    receivedAt: 500,
  };
  assert.equal(attemptElapsed(active, 1500), 2000);
  assert.equal(attemptElapsed({ ...active, paused: true }, 1500), 1000);
  assert.equal(newRecoverySecret().length, 43);
});

test("HTTP局域网环境没有randomUUID时仍使用密码学随机编号", () => {
  const provider = {
    getRandomValues: (value) => crypto.getRandomValues(value),
  };
  assert.match(
    newRequestId(provider),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("新规则创建和小游戏重试保留尝试编号与输入序号", async () => {
  const store = storage();
  const requests = [];
  let loseResponse = false;
  const current = { ...snapshot, phase: 'event', attempt: { id: 'attempt-id', inputSeq: 7 } };
  const client = createApiClient({
    rulesVersion: 'chapter-games-1', storage: store,
    getSession: () => session, getSnapshot: () => current,
    fetcher: async (_, options) => {
      requests.push(JSON.parse(options.body));
      if (loseResponse) { loseResponse = false; throw new Error('lost'); }
      return Response.json({ id: session.id, token: session.token, seat: 0, snapshot: current });
    },
  });
  await client.create();
  assert.equal(requests[0].rulesVersion, 'chapter-games-1');
  loseResponse = true;
  await assert.rejects(client.action('coop_light', { from: [0,0], to: [4,0] }), /连接失败/);
  await client.action('coop_light', { from: [0,0], to: [4,0] });
  assert.deepEqual(requests[1], requests[2]);
  assert.equal(requests[2].attemptId, 'attempt-id');
  assert.equal(requests[2].inputSeq, 8);
  await client.action('coop_move', { direction: 'right' });
  assert.equal(requests[3].inputSeq, 9);
  assert.equal(attemptElapsed({ attempt: { startedAt: null, duration: 180000, elapsed: 0 }, receivedAt: 0 }, 5000), 0);
});
