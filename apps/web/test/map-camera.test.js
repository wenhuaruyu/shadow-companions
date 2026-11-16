import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPoint, updateMapCamera } from '../src/games/map-camera.js';

globalThis.getComputedStyle = canvas => ({ objectFit: canvas.objectFit || 'fill' });

test('跟随视野在地图边缘停止，缩放保持原比例', () => {
  const canvas = { width: 500, height: 500, clientWidth: 800, parentElement: { clientHeight: 300 }, style: {} };
  updateMapCamera(canvas, [0, 0], 50);
  assert.equal(canvas.style.transform, 'translateY(0px)');
  updateMapCamera(canvas, [5, 5], 50);
  assert.equal(canvas.style.transform, 'translateY(-290px)');
  updateMapCamera(canvas, [9, 9], 50);
  assert.equal(canvas.style.transform, 'translateY(-500px)');
});

test('后巷视野预留状态栏，视口扩大后重新计算', () => {
  const canvas = { width: 910, height: 630, clientWidth: 910, parentElement: { clientHeight: 340 }, style: {} };
  updateMapCamera(canvas, [11, 7], 70, 40);
  assert.equal(canvas.style.transform, 'translateY(-330px)');
  canvas.parentElement.clientHeight = 740;
  updateMapCamera(canvas, [11, 7], 70, 40);
  assert.equal(canvas.style.transform, 'translateY(0px)');
});

test('全地图视角的留白不影响照明格坐标', () => {
  const canvas = { objectFit: 'contain', width: 500, height: 500, getBoundingClientRect: () => ({ left: 20, top: 40, width: 800, height: 300 }) };
  assert.deepEqual(mapPoint(canvas, { clientX: 435, clientY: 205 }, 10, 10), [5, 5]);
  assert.deepEqual(mapPoint(canvas, { clientX: 270, clientY: 40 }, 10, 10), [0, 0]);
});

test('跟随视野平移后仍可点击正确的相邻格', () => {
  const canvas = { width: 500, height: 500, getBoundingClientRect: () => ({ left: 20, top: -250, width: 800, height: 800 }) };
  assert.deepEqual(mapPoint(canvas, { clientX: 460, clientY: 190 }, 10, 10), [5, 5]);
});
