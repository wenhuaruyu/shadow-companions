import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './rooms.js';
import { referenceLayout, referenceCanMove } from './cooperative-layout.js';

export const COOP_GAME_ID = 'chapter-2-cooperative';
export const DURATION = 180000;
export const LIGHT_DURATION = 20000;
export const LIGHT_COOLDOWN = 5000;
const width = 15;
const height = 11;
const directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const fail = (code, message, status = 409) => { throw new ApiError(status, code, message); };

// Fixed seed keeps every greybox run and server replay on the same maze.
function buildMaze() {
  const cells = Array.from({ length: height }, () => Array(width).fill('#'));
  let seed = 271;
  const stack = [[1, 1]];
  cells[1][1] = '.';
  while (stack.length) {
    const [x, y] = stack.at(-1);
    const options = Object.values(directions).filter(([dx, dy]) =>
      x + dx * 2 > 0 && x + dx * 2 < width - 1 && y + dy * 2 > 0 && y + dy * 2 < height - 1 && cells[y + dy * 2][x + dx * 2] === '#');
    if (!options.length) { stack.pop(); continue; }
    seed = (seed * 16807) % 2147483647;
    const [dx, dy] = options[seed % options.length];
    cells[y + dy][x + dx] = '.';
    cells[y + dy * 2][x + dx * 2] = '.';
    stack.push([x + dx * 2, y + dy * 2]);
  }
  return cells.map(row => row.join(''));
}
const originalMaze = buildMaze();
function addBranches(original) {
  const cells = original.map(row => [...row]);
  // Join separated corridors in six areas to create loops and useful choices.
  for (const [x, y] of [[1, 2], [5, 2], [9, 2], [13, 4], [5, 6], [9, 8]]) cells[y][x] = '.';
  return cells.map(row => row.join(''));
}
const branchMaze = addBranches(originalMaze);
const legacyStart = [1, 1];
const legacyExit = [13, 9];
const deadEnds = [];
for (let y = 1; y < height - 1; y++) {
  for (let x = 1; x < width - 1; x++) {
    if (originalMaze[y][x] === '.' && !same([x, y], legacyStart) && !same([x, y], legacyExit) &&
        Object.values(directions).filter(([dx, dy]) => originalMaze[y + dy][x + dx] === '.').length === 1) deadEnds.push([x, y]);
  }
}
const candidates = [...deadEnds];
for (let y = 1; y < height; y += 2) {
  for (let x = 1; x < width; x += 2) {
    if (!same([x, y], legacyStart) && !same([x, y], legacyExit) && !candidates.some(p => same(p, [x, y]))) candidates.push([x, y]);
  }
}
const legacyPeople = candidates.slice(0, 5).map((position, id) => ({ id, position, color: ['#e96969', '#eab84c', '#60b88c', '#5da6df', '#c58dd7'][id] }));

export const maze = referenceLayout.grid;
export const people = referenceLayout.people;
export const start = referenceLayout.start;
export const exit = referenceLayout.exit;
function layoutFor(game) {
  return game.mapVersion === 3 ? referenceLayout : {
    grid: game.mapVersion === 2 ? branchMaze : originalMaze,
    people: legacyPeople, start: legacyStart, exit: legacyExit, walls: [],
  };
}
export function canMove(from, to, mapVersion = 3) {
  if (mapVersion === 3) return referenceCanMove(from, to);
  const layout = layoutFor({ mapVersion });
  return Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1 && layout.grid[to[1]]?.[to[0]] === '.';
}

export function initialCooperative() {
  return { mode: COOP_GAME_ID, phase: 'coop-lobby', chapter: 1, players: [0, 1].map(() => ({ int: 0, str: 0, role: null, ready: false })),
    coop: { id: randomUUID(), mapVersion: 3, startedAt: null, position: [...start], found: [], lights: [], lastLightAt: null, lastMoveAt: null, done: false, escaped: false, reward: 0 } };
}

export function settleCooperative(state, now, rewards, escaped = false) {
  const game = state.coop;
  if (game.done || game.startedAt === null || (!escaped && now < game.startedAt + DURATION)) return false;
  game.done = true;
  game.escaped = escaped;
  game.reward = [0, 1, 2, 4, 6, 8][game.found.length] + (escaped ? 2 : 0);
  state.phase = 'coop-result';
  state.players.forEach((player, seat) => {
    player[player.role] += game.reward;
    rewards.push({ seat, attemptId: game.id, attribute: player.role, amount: game.reward });
  });
  return true;
}

export function applyCooperative(state, seat, playerCount, kind, data, now, rewards) {
  const game = state.coop;
  const player = state.players[seat];
  if (game.done) fail('ATTEMPT_ENDED', '本轮协作已结束');
  if (kind === 'role') {
    if (state.phase !== 'coop-lobby' || player.ready) fail('PHASE_MISMATCH', '准备后不能更改分工');
    if (!['int', 'str'].includes(data.role)) fail('INVALID_INPUT', '分工无效', 400);
    if (state.players.some((other, index) => index !== seat && other.role === data.role)) fail('ROLE_TAKEN', '同伴已选择该分工');
    player.role = data.role;
    return;
  }
  if (kind === 'ready') {
    if (state.phase !== 'coop-lobby' || !player.role || typeof data.ready !== 'boolean') fail('PHASE_MISMATCH', '请先选择分工');
    player.ready = data.ready;
    if (playerCount === 2 && state.players.every(other => other.ready)) {
      game.startedAt = now;
      state.phase = 'coop-playing';
    }
    return;
  }
  if (state.phase !== 'coop-playing') fail('PHASE_MISMATCH', '请等待双方准备');
  if (kind === 'move') {
    if (player.role !== 'str') fail('ROLE_FORBIDDEN', '只有营救者可以移动', 403);
    const delta = directions[data.direction];
    if (!delta) fail('INVALID_INPUT', '方向无效', 400);
    if (game.lastMoveAt !== null && now - game.lastMoveAt < 200) fail('MOVE_COOLDOWN', '移动过快');
    game.lastMoveAt = now;
    const target = [game.position[0] + delta[0], game.position[1] + delta[1]];
    if (canMove(game.position, target, game.mapVersion ?? 1)) game.position = target;
    for (const person of layoutFor(game).people) {
      if (same(game.position, person.position) && !game.found.includes(person.id)) game.found.push(person.id);
    }
    if (same(game.position, layoutFor(game).exit)) settleCooperative(state, now, rewards, true);
  } else if (kind === 'light') {
    if (player.role !== 'int') fail('ROLE_FORBIDDEN', '只有引路者可以照明', 403);
    const valid = point => Array.isArray(point) && point.length === 2 && point.every(Number.isInteger) && point[0] >= 0 && point[0] < layoutFor(game).grid[0].length && point[1] >= 0 && point[1] < layoutFor(game).grid.length;
    const { from, to } = data;
    if (!valid(from) || !valid(to) || (from[0] !== to[0] && from[1] !== to[1]) || Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) > 4) fail('INVALID_INPUT', '每笔须为横向或纵向连续一至五格', 400);
    if (game.lastLightAt !== null && now - game.lastLightAt < LIGHT_COOLDOWN) fail('LIGHT_COOLDOWN', '照明尚在冷却');
    game.lights = game.lights.filter(light => light.expiresAt > now);
    game.lights.push({ from, to, expiresAt: now + LIGHT_DURATION });
    game.lastLightAt = now;
  } else if (kind === 'escape') {
    if (player.role !== 'str' || !same(game.position, layoutFor(game).exit)) fail('EXIT_UNAVAILABLE', '营救者到达出口才能撤离');
    settleCooperative(state, now, rewards, true);
  } else fail('INVALID_INPUT', '动作无效', 400);
}

export function cooperativeSnapshot(document, now) {
  const { state, seat } = document;
  const game = state.coop;
  const role = state.players[seat].role;
  const layout = layoutFor(game);
  const lights = game.lights.filter(light => light.expiresAt > now);
  const visible = (x, y) => role === 'int' || game.done || same(game.position, [x, y]) || lights.some(light =>
    x >= Math.min(light.from[0], light.to[0]) && x <= Math.max(light.from[0], light.to[0]) &&
    y >= Math.min(light.from[1], light.to[1]) && y <= Math.max(light.from[1], light.to[1]));
  const playing = game.startedAt !== null;
  return { id: document.id, version: document.version, gameId: COOP_GAME_ID, chapter: 2, phase: state.phase, me: seat, role,
    players: state.players.slice(0, document.playerCount).map(player => ({ ...player })), serverNow: now,
    remaining: playing ? Math.max(0, game.startedAt + DURATION - now) : DURATION,
    cooldown: game.lastLightAt === null ? 0 : Math.max(0, game.lastLightAt + LIGHT_COOLDOWN - now),
    position: game.position, found: game.found, done: game.done, escaped: game.escaped, reward: game.reward,
    width: layout.grid[0].length, height: layout.grid.length, mapVersion: game.mapVersion ?? 1,
    grid: playing ? layout.grid.map((row, y) => [...row].map((cell, x) => visible(x, y) ? cell : '?').join('')) : null,
    people: playing ? layout.people.filter(person => !game.found.includes(person.id) && visible(...person.position)) : [],
    exit: playing && visible(...layout.exit) ? layout.exit : null,
    walls: playing ? layout.walls.filter(wall => {
      const [x, y] = wall.from;
      const adjacent = wall.from[0] === wall.to[0] ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
      return adjacent.some(([a, b]) => a >= 0 && a < layout.grid[0].length && b >= 0 && b < layout.grid.length && visible(a, b));
    }) : [],
    lights: playing ? lights : [] };
}

export class CooperativeService {
  constructor(rooms, clock = Date.now) { this.rooms = rooms; this.clock = clock; }

  async load(room, token, requestId) {
    if (typeof room !== 'string' || !/^[0-9a-f-]{36}$/.test(room) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('INVALID_CREDENTIAL', '本人凭证无效', 401);
    return this.rooms.loadGame(room, token, requestId);
  }

  async enter(body, joining) {
    const entry = await this.rooms.enter(body, joining);
    for (let retry = 0; retry < 5; retry++) {
      const document = await this.load(entry.id, body.recoverySecret);
      if (document.state?.mode === COOP_GAME_ID) return { ...entry, snapshot: await this.state(entry.id, body.recoverySecret) };
      if (joining || document.state) fail('WRONG_GAME', '请使用第二章协作房间');
      document.state = initialCooperative();
      const result = await this.rooms.commitGame(document, body.recoverySecret, []);
      if (!result.conflict) return { ...entry, snapshot: await this.state(entry.id, body.recoverySecret) };
    }
    fail('TEMPORARILY_UNAVAILABLE', '状态繁忙，请重试', 503);
  }

  async transact(room, token, body = null) {
    if (body && (!['role', 'ready', 'move', 'light', 'escape'].includes(body.kind) ||
        typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId) ||
        !body.data || typeof body.data !== 'object' || Array.isArray(body.data))) fail('INVALID_INPUT', '动作格式错误', 400);
    const payload = body ? createHash('sha256').update(JSON.stringify([body.kind, body.data])).digest('hex') : null;
    for (let retry = 0; retry < 8; retry++) {
      const document = await this.load(room, token, body?.requestId);
      if (document.state?.mode !== COOP_GAME_ID) fail('WRONG_GAME', '请使用第二章协作房间');
      const rewards = [];
      const now = this.clock();
      if (settleCooperative(document.state, now, rewards)) {
        await this.rooms.commitGame(document, token, rewards);
        continue;
      }
      if (document.receipt) {
        if (document.receipt.payload !== payload) fail('REQUEST_ID_CONFLICT', '请求编号已用于不同操作');
        return cooperativeSnapshot(document, now);
      }
      if (!body) return cooperativeSnapshot(document, now);
      applyCooperative(document.state, document.seat, document.playerCount, body.kind, body.data, now, rewards);
      const result = await this.rooms.commitGame(document, token, rewards, body.requestId, payload);
      if (!result.conflict) return this.state(room, token);
    }
    fail('TEMPORARILY_UNAVAILABLE', '状态繁忙，请重试', 503);
  }

  state(room, token) { return this.transact(room, token); }
  async action(body, token) { return { snapshot: await this.transact(body?.room, token, body) }; }
}
