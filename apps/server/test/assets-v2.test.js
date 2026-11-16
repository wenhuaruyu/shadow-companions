import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomServer } from '../src/v2/server.js';

test('生产服务提供原设计首页、小游戏及素材，隔离部署私有文件', async () => {
  const server = createRoomServer(null, 'https://game.example.com');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/online.html', '/src/design-network.js', '/games/strength.html', '/games/investigation.html', '/games/cooperative.html', '/assets/figma/1adc6.png']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      if (path === '/') assert.ok((await response.text()).includes('data-network'));
    }
    const manifest = await (await fetch(origin + '/figma/manifest.json')).json();
    for (const scene of manifest.scenes) {
      assert.equal((await fetch(origin + scene.file, { method: 'HEAD' })).status, 200, scene.file);
    }
    for (const path of ['/.env', '/package.json', '/src/%2e%2e/%2e%2e/.env']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
    const image = await fetch(origin + '/assets/figma/1adc6.png');
    assert.match(image.headers.get('cache-control'), /max-age=/);
    assert.ok(image.headers.get('etag'));
    const cached = await fetch(origin + '/assets/figma/1adc6.png', { headers: { 'If-None-Match': image.headers.get('etag') } });
    assert.equal(cached.status, 304);
    assert.equal((await cached.arrayBuffer()).byteLength, 0);
    const page = await fetch(origin + '/');
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const compressed = await fetch(origin + '/src/styles/figma.css', { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(compressed.status, 200);
    assert.match(await compressed.text(), /tailwindcss/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
