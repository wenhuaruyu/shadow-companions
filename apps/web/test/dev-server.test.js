import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWebServer } from "../dev-server.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("代理保留方法、查询、私有请求头、请求体和业务错误", async () => {
  const backend = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(409, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        url: request.url,
        method: request.method,
        body,
        token: request.headers.authorization,
        version: request.headers["x-contract-version"],
      }),
    );
  });
  const target = await listen(backend);
  const web = createWebServer({ apiTarget: target });
  const origin = await listen(web);
  try {
    const response = await fetch(`${origin}/api/action?room=abc`, {
      method: "POST",
      headers: { Authorization: "Bearer private", "X-Contract-Version": "2" },
      body: JSON.stringify({ kind: "ready" }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      url: "/api/action?room=abc",
      method: "POST",
      body: '{"kind":"ready"}',
      token: "Bearer private",
      version: "2",
    });
    assert.equal((await fetch(origin + "/")).status, 200);
    assert.equal((await fetch(origin + "/src/main.js")).status, 200);
    assert.equal((await fetch(origin + "/.env")).status, 404);
    assert.equal((await fetch(origin + "/package.json")).status, 404);
    assert.equal(
      (
        await fetch(origin + "/assets/opening-hongkong-two-women.png")
      ).headers.get("content-type"),
      "image/png",
    );
  } finally {
    await close(web);
    await close(backend);
  }
});
