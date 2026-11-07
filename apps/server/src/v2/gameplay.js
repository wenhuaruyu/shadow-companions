import { createHash, randomInt } from 'node:crypto';
import { ApiError, CONTENT_VERSION } from './rooms.js';
import { instructions } from './content.js';
import { initialState, gameSnapshot } from './snapshot.js';

const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const kinds = ['ready', 'instruction', 'tutorial', 'enter', 'read'];
const envelopeKeys = ['room', 'requestId', 'kind', 'data', 'expectedVersion', 'expectedPhase', 'chapter'];

function validateAction(body) {
  if (!object(body) || Object.keys(body).some(key => !envelopeKeys.includes(key))
    || typeof body.room !== 'string' || !/^[0-9a-f-]{36}$/.test(body.room)
    || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)
    || !kinds.includes(body.kind) || !object(body.data)
    || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1
    || typeof body.expectedPhase !== 'string') fail(400, 'INVALID_INPUT', '动作格式错误');
  const dataKeys = Object.keys(body.data);
  if (body.kind === 'ready') {
    if (dataKeys.length !== 1 || typeof body.data.ready !== 'boolean') fail(400, 'INVALID_INPUT', '准备状态须为布尔值');
  } else if (dataKeys.length) fail(400, 'INVALID_INPUT', '此动作不接受附加数据');
  if (['enter', 'read'].includes(body.kind) && ![0, 1].includes(body.chapter)) fail(400, 'INVALID_INPUT', '地点编号错误');
}

function apply(document, body) {
  const state = document.state;
  const player = state.players[document.seat];
  if (body.expectedVersion !== document.version) {
    const error = new ApiError(409, 'VERSION_CONFLICT', '状态已变化，请刷新');
    error.currentVersion = document.version;
    throw error;
  }
  if (body.expectedPhase !== state.phase) fail(409, 'PHASE_MISMATCH', '阶段已变化');
  const requirePhase = phase => { if (state.phase !== phase) fail(409, 'PHASE_MISMATCH', '当前阶段不允许此操作'); };
  const all = key => document.playerCount === 2 && state.players.every(item => item[key]);
  switch (body.kind) {
    case 'ready':
      requirePhase('lobby');
      player.ready = body.data.ready;
      if (all('ready')) {
        const secretSeat = randomInt(2);
        state.players.forEach((item, seat) => { item.role = seat === secretSeat ? 'secret' : 'courier'; });
        state.phase = 'brief';
      }
      break;
    case 'instruction':
      requirePhase('brief');
      player.instruction = true;
      break;
    case 'tutorial':
      requirePhase('brief');
      if (!player.instruction) fail(409, 'PHASE_MISMATCH', '请先确认个人指令');
      player.tutorial = true;
      if (all('tutorial')) state.phase = 'map';
      break;
    case 'enter':
      requirePhase('map');
      if (body.chapter !== state.chapter) fail(409, 'PHASE_MISMATCH', '地点已变化');
      player.entered = true;
      if (all('entered')) state.phase = 'story';
      break;
    case 'read':
      requirePhase('story');
      if (body.chapter !== state.chapter) fail(409, 'PHASE_MISMATCH', '地点已变化');
      player.read = true;
      if (all('read')) state.phase = 'event';
      break;
  }
}

// Both native PG and cloud RPC use the same atomic compare-and-commit boundary.
export class GameplayService {
  constructor(rooms) {
    this.rooms = rooms;
  }

  async enter(body, joining = false) {
    const result = await this.rooms.enter(body, joining);
    return { ...result, snapshot: await this.state(result.id, body.recoverySecret) };
  }

  async load(room, token, requestId) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || typeof room !== 'string' || !/^[0-9a-f-]{36}$/.test(room)) {
      fail(401, 'INVALID_CREDENTIAL', '本人凭证无效');
    }
    const document = await this.rooms.loadGame(room, token, requestId);
    if (document.contentVersion !== CONTENT_VERSION) fail(400, 'CONTENT_VERSION_UNSUPPORTED', '内容版本不受支持');
    document.state ||= initialState();
    return document;
  }

  async state(room, token) {
    return gameSnapshot(await this.load(room, token));
  }

  async instruction(room, token) {
    const document = await this.load(room, token);
    const role = document.state.players[document.seat].role;
    if (!role) fail(409, 'PHASE_MISMATCH', '个人指令尚未生成');
    return { title: '个人指令', text: instructions[role] };
  }

  async action(body, token) {
    validateAction(body);
    const payload = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      const document = await this.load(body.room, token, body.requestId);
      if (document.receipt) {
        if (document.receipt.payload !== payload) fail(409, 'REQUEST_ID_CONFLICT', '请求编号已用于不同参数');
        return { replayed: true, appliedVersion: document.receipt.appliedVersion, snapshot: gameSnapshot(document) };
      }
      apply(document, body);
      const result = await this.rooms.commitGame(document, token, body.requestId, payload);
      if (!result.conflict) return { replayed: result.replayed, appliedVersion: result.appliedVersion,
        snapshot: await this.state(body.room, token) };
    }
    fail(503, 'TEMPORARILY_UNAVAILABLE', '状态繁忙，请稍后重试');
  }
}
