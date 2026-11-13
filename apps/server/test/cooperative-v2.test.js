import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { RoomService } from '../src/v2/rooms.js';
import { CooperativeService, initialCooperative, applyCooperative, settleCooperative, cooperativeSnapshot, maze, people, start, exit, canMove } from '../src/v2/cooperative.js';

function playing() {
  const state = initialCooperative();
  applyCooperative(state, 0, 2, 'role', { role: 'int' }, 1000, []);
  applyCooperative(state, 1, 2, 'role', { role: 'str' }, 1000, []);
  applyCooperative(state, 0, 2, 'ready', { ready: true }, 1000, []);
  assert.equal(state.coop.startedAt, null);
  applyCooperative(state, 1, 2, 'ready', { ready: true }, 1000, []);
  return state;
}
const document = (state, seat) => ({ id: randomUUID(), state, seat, playerCount: 2, version: 1 });

test('协作权限、五格直线、冷却、重叠照明独立到期和营救者隐私', () => {
  const state = playing();
  assert.throws(() => applyCooperative(state, 1, 2, 'light', { from: [1, 1], to: [5, 1] }, 1000, []), /只有引路者/);
  assert.throws(() => applyCooperative(state, 0, 2, 'move', { direction: 'right' }, 1000, []), /只有营救者/);
  assert.throws(() => applyCooperative(state, 0, 2, 'light', { from: [1, 1], to: [6, 1] }, 1000, []), /五格/);
  assert.throws(() => applyCooperative(state, 0, 2, 'light', { from: [1, 1], to: [2, 2] }, 1000, []), /五格/);
  const hidden = cooperativeSnapshot(document(state, 1), 1000);
  assert.equal(hidden.grid.flatMap(row => [...row]).filter(cell => cell !== '?').length, 1);
  assert.equal(hidden.people.length, 0); assert.equal(hidden.exit, null);
  applyCooperative(state, 0, 2, 'light', { from: [1, 1], to: [5, 1] }, 1000, []);
  assert.equal(cooperativeSnapshot(document(state, 1), 1000).grid[1][4], '.');
  assert.ok(cooperativeSnapshot(document(state, 1), 1000).walls.length > 0);
  assert.throws(() => applyCooperative(state, 0, 2, 'light', { from: [1, 1], to: [5, 1] }, 5999, []), /冷却/);
  applyCooperative(state, 0, 2, 'light', { from: [3, 1], to: [7, 1] }, 6000, []);
  const overlap = cooperativeSnapshot(document(state, 1), 21000);
  assert.equal(overlap.grid[1][2], '?'); assert.equal(overlap.grid[1][3], '.');
  assert.equal(cooperativeSnapshot(document(state, 1), 26000).grid[1][3], '?');
  assert.equal(cooperativeSnapshot(document(state, 0), 26000).grid[9][9], '.');
});

test('黑格移动、碰墙、触碰救人去重、提前撤离和全部梯度奖励', () => {
  const state = playing();
  applyCooperative(state, 1, 2, 'move', { direction: 'right' }, 1000, []);
  assert.deepEqual(state.coop.position, [1, 0]);
  const view = cooperativeSnapshot(document(state, 1), 1000);
  assert.equal(view.grid[0][0], '?'); assert.equal(view.grid[0][1], '.');
  applyCooperative(state, 1, 2, 'move', { direction: 'up' }, 1200, []);
  assert.deepEqual(state.coop.position, [1, 0]);
  state.coop.position = [4, 0];
  applyCooperative(state, 1, 2, 'move', { direction: 'right' }, 1400, []);
  assert.deepEqual(state.coop.position, [4, 0]);
  const [x, y] = people[0].position;
  const adjacent = [[x-1,y,'right'],[x+1,y,'left'],[x,y-1,'down'],[x,y+1,'up']].find(([a,b]) => canMove([a,b],[x,y]));
  for (const now of [1600,1800]) {
    state.coop.position = adjacent.slice(0,2);
    applyCooperative(state, 1, 2, 'move', { direction: adjacent[2] }, now, []);
  }
  assert.equal(state.coop.found.length, 1);
  for (let count = 0; count <= 5; count++) {
    for (const escaped of [false, true]) {
      const run = playing(), rewards = [];
      run.coop.found = people.slice(0,count).map(person => person.id);
      run.coop.position = [...exit];
      if (escaped) applyCooperative(run, 1, 2, 'escape', {}, 1500, rewards);
      else settleCooperative(run, 181000, rewards);
      const amount = [0,1,2,4,6,8][count] + (escaped ? 2 : 0);
      assert.equal(run.coop.reward, amount); assert.equal(rewards.length, 2);
      assert.equal(run.players[0].int, amount); assert.equal(run.players[1].str, amount);
      assert.equal(settleCooperative(run, 190000, rewards, true), false); assert.equal(rewards.length, 2);
    }
  }
});

export function route(from, to) {
  const queue = [[from, []]], seen = new Set([String(from)]);
  for (let i = 0; i < queue.length; i++) {
    const [point, path] = queue[i];
    if (String(point) === String(to)) return path;
    for (const [direction,[dx,dy]] of Object.entries({up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]})) {
      const next = [point[0]+dx,point[1]+dy];
      if (canMove(point, next) && !seen.has(String(next))) { seen.add(String(next)); queue.push([next,[...path,direction]]); }
    }
  }
  throw new Error('Unreachable');
}

test('参考图迷宫保留七个盲端与十五处分支，旧房间保留原地图', () => {
  let floor = 0, edges = 0, junctions = 0, deadEnds = 0;
  for (let y = 0; y < maze.length; y++) {
    for (let x = 0; x < maze[y].length; x++) {
      if (maze[y][x] !== '.') continue;
      floor++;
      const degree = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy]) => canMove([x,y],[x+dx,y+dy])).length;
      edges += degree;
      if (degree >= 3) junctions++;
      if (degree === 1) deadEnds++;
    }
  }
  assert.equal(junctions, 15);
  assert.equal(deadEnds, 7);
  assert.equal(edges / 2 - floor + 1, 5);
  const state = playing();
  assert.equal(cooperativeSnapshot(document(state, 0), 1000).width, 10);
  state.coop.mapVersion = 2;
  assert.equal(cooperativeSnapshot(document(state, 0), 1000).grid[2][1], '.');
  delete state.coop.mapVersion;
  assert.equal(cooperativeSnapshot(document(state, 0), 1000).grid[2][1], '#');
});

test('五个人和出口全部可达，基础全营救路线在三分钟移动预算内', () => {
  let position = start, steps = 0;
  for (const target of [...people.map(person=>person.position),exit]) { steps += route(position,target).length; position = target; }
  assert.ok(steps * 220 < 180000);
});

test('真实PG协作并发、请求重放、刷新恢复、期限结算和奖励流水去重', { skip: !process.env.PG_TEST_URL }, async () => {
  const pool = new pg.Pool({connectionString:process.env.PG_TEST_URL});
  let now = 1000;
  const rooms = new RoomService(pool,'http://localhost:5175');
  const service = new CooperativeService(rooms,()=>now);
  const entry = () => ({requestId:randomUUID(),recoverySecret:randomBytes(32).toString('base64url'),contentVersion:'mvp-two-sites-1'});
  const host=entry(),guest=entry(); let id;
  try {
    const created=await service.enter(host,false);id=created.id;
    const joined=await service.enter({...guest,room:id},true);assert.equal(joined.seat,1);
    const action=(token,kind,data={},requestId=randomUUID())=>service.action({room:id,requestId,kind,data},token);
    const race=await Promise.allSettled([action(host.recoverySecret,'role',{role:'int'}),action(guest.recoverySecret,'role',{role:'int'})]);
    assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
    const winner=race[0].status==='fulfilled'?host:guest,loser=winner===host?guest:host;
    await action(loser.recoverySecret,'role',{role:'str'});
    await Promise.all([action(host.recoverySecret,'ready',{ready:true}),action(guest.recoverySecret,'ready',{ready:true})]);
    const requestId=randomUUID();
    await action(winner.recoverySecret,'light',{from:[1,1],to:[5,1]},requestId);
    const replay=await action(winner.recoverySecret,'light',{from:[1,1],to:[5,1]},requestId);
    assert.equal(replay.snapshot.lights.length,1);
    const restored=new CooperativeService(rooms,()=>now);
    assert.equal((await restored.state(id,loser.recoverySecret)).grid[1][5],'.');
    now=21000;
    assert.equal((await restored.state(id,loser.recoverySecret)).grid[1][5],'?');
    const moveId=randomUUID();
    now=22000;
    await action(loser.recoverySecret,'move',{direction:'right'},moveId);
    const moved=await action(loser.recoverySecret,'move',{direction:'right'},moveId);
    assert.deepEqual(moved.snapshot.position,[1,0]);
    now=181000;
    await Promise.all([restored.state(id,host.recoverySecret),restored.state(id,guest.recoverySecret)]);
    const rows=await pool.query('SELECT seat,attribute,amount FROM anxian.resource_ledger WHERE room_id=$1',[id]);
    assert.equal(rows.rowCount,2);assert.ok(rows.rows.every(row=>row.amount===0));
    assert.equal((await restored.state(id,host.recoverySecret)).done,true);
    await assert.rejects(action(loser.recoverySecret,'move',{direction:'right'}),/已结束/);
  } finally {
    if (id) {
      for (const table of ['resource_ledger', 'game_actions', 'game_requests', 'game_players']) {
        await pool.query(`DELETE FROM anxian.${table} WHERE room_id=$1`, [id]);
      }
      await pool.query('DELETE FROM anxian.game_rooms WHERE id=$1', [id]);
    }
    await pool.end();
  }
});

 test('走入出口自动结束双方行动并只结算一次', () => {
  const state = playing();
  const rewards = [];
  state.coop.found = [0, 1, 2, 3, 4];
  const path = route(start, exit);
  let now = 1200;
  for (const direction of path) {
    applyCooperative(state, 1, 2, 'move', { direction }, now, rewards);
    now += 220;
  }
  assert.equal(state.coop.done, true);
  assert.equal(state.coop.escaped, true);
  assert.equal(state.coop.reward, 10);
  assert.equal(state.phase, 'coop-result');
  assert.equal(rewards.length, 2);
  assert.throws(() => applyCooperative(state, 1, 2, 'escape', {}, now, rewards), /已结束/);
  assert.equal(rewards.length, 2);
});
