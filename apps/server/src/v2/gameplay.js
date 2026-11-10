import { createHash, randomInt, randomUUID } from 'node:crypto';
import { ApiError, CONTENT_VERSION } from './rooms.js';
import { questions, instructions, rules } from './content.js';

const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const inputKinds = ['answers', 'hit'];
const chapterKinds = ['enter', 'read'];
const eventKinds = ['start', 'answers', 'hit', 'finish', 'abandon'];
const kinds = ['ready', 'instruction', 'tutorial', 'enter', 'read', ...eventKinds];

function initialState() {
  return { phase: 'lobby', chapter: 0, players: [0, 1].map(() => ({
    int: 5, str: 5, ready: false, instruction: false, tutorial: false,
    entered: false, read: false, continued: false, role: null, attempt: null
  })), records: [] };
}

function elapsed(attempt, now) {
  return Math.min(attempt.duration, Math.max(0, now - attempt.startedAt));
}

function finish(state, seat, rewards, now, abandoned = false) {
  const player = state.players[seat];
  const attempt = player.attempt;
  if (attempt.done) return;
  const score = attempt.type === 'int'
    ? questions[state.chapter].reduce((total, question, index) => total + Number(attempt.answers[index] === question[2]), 0)
    : attempt.hits;
  const reward = attempt.type === 'int' ? [0, 3, 6, 10][score] : score;
  Object.assign(attempt, { done: true, score, reward, abandoned, elapsed: elapsed(attempt, now) });
  player[attempt.type] += reward;
  rewards.push({ seat, attemptId: attempt.id, attribute: attempt.type, amount: reward });
  if (state.players.every(item => item.attempt?.done)) state.phase = 'invest';
}

function settleExpired(state, rewards, now) {
  let changed = false;
  for (let seat = 0; seat < state.players.length; seat++) {
    const attempt = state.players[seat].attempt;
    if (attempt && !attempt.done && elapsed(attempt, now) >= attempt.duration) {
      finish(state, seat, rewards, now);
      changed = true;
    }
  }
  return changed;
}

export function gameSnapshot(document, now) {
  const state = document.state || initialState();
  const mine = state.players[document.seat].attempt;
  return {
    id: document.id, version: document.version, contentVersion: document.contentVersion,
    rulesVersion: 'mvp-rules-1', phase: state.phase, chapter: state.chapter,
    ended: false, outcome: null, paused: false, pause: null,
    requirements: state.chapter ? { int: 6, str: 4 } : { int: 5, str: 5 },
    me: document.seat, players: state.players.slice(0, document.playerCount).map((player, seat) => ({
      name: seat ? '顾宁' : '林舟', int: player.int, str: player.str,
      ready: player.ready, instruction: player.instruction, tutorial: player.tutorial,
      entered: player.entered, read: player.read, continued: player.continued, online: false,
      event: player.attempt ? { type: player.attempt.type, done: player.attempt.done, reward: player.attempt.reward } : null,
      investment: null
    })),
    attempt: mine ? {
      id: mine.id, type: mine.type, duration: mine.duration, elapsed: mine.done ? mine.elapsed : elapsed(mine, now),
      startedAt: mine.startedAt, answers: mine.answers, sequence: mine.sequence,
      used: mine.used, hits: mine.hits, inputSeq: mine.inputSeq, done: mine.done,
      score: mine.score, reward: mine.reward, abandoned: mine.abandoned
    } : null,
    questions: mine?.type === 'int' ? questions[state.chapter].map(question => ({ text: question[0], options: question[1] })) : null,
    investmentDraft: null, records: state.records
  };
}

function validateAction(body) {
  if (!object(body) || Object.keys(body).some(key => !['room', 'requestId', 'kind', 'data', 'expectedVersion', 'expectedPhase', 'chapter', 'attemptId', 'inputSeq'].includes(key)) || typeof body.room !== 'string' || !/^[0-9a-f-]{36}$/.test(body.room)
    || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)
    || !kinds.includes(body.kind) || !object(body.data)) fail(400, 'INVALID_INPUT', '动作格式错误');
  if (!inputKinds.includes(body.kind) && (!integer(body.expectedVersion) || typeof body.expectedPhase !== 'string')) {
    fail(400, 'INVALID_INPUT', '缺少预期版本或阶段');
  }
  if ([...eventKinds, ...chapterKinds].includes(body.kind) && ![0, 1].includes(body.chapter)) fail(400, 'INVALID_INPUT', '地点编号错误');
  if (eventKinds.includes(body.kind) && body.kind !== 'start' &&
    (typeof body.attemptId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.attemptId))) {
    fail(400, 'INVALID_INPUT', '尝试编号错误');
  }
  if (inputKinds.includes(body.kind) && !integer(body.inputSeq)) fail(400, 'INVALID_INPUT', '输入序号错误');
}

function apply(state, document, body, rewards, now) {
  const player = state.players[document.seat];
  if (!inputKinds.includes(body.kind) && body.expectedVersion !== document.version) {
    const error = new ApiError(409, 'VERSION_CONFLICT', '状态已变化，请刷新');
    error.currentVersion = document.version;
    throw error;
  }
  if (!inputKinds.includes(body.kind) && body.expectedPhase !== state.phase) fail(409, 'PHASE_MISMATCH', '阶段已变化');
  if (eventKinds.includes(body.kind) && body.chapter !== state.chapter) fail(409, 'PHASE_MISMATCH', '地点已变化');
  const requirePhase = phase => { if (state.phase !== phase) fail(409, 'PHASE_MISMATCH', '当前阶段不允许此操作'); };
  const all = key => document.playerCount === 2 && state.players.every(item => item[key]);
  switch (body.kind) {
    case 'ready':
      requirePhase('lobby');
      if (typeof body.data.ready !== 'boolean') fail(400, 'INVALID_INPUT', '准备状态须为布尔值');
      player.ready = body.data.ready;
      if (all('ready')) {
        const secretSeat = randomInt(2);
        state.players.forEach((item, seat) => { item.role = seat === secretSeat ? 'secret' : 'courier'; });
        state.phase = 'brief';
      }
      return;
    case 'instruction':
      requirePhase('brief');
      player.instruction = true;
      return;
    case 'tutorial':
      requirePhase('brief');
      if (!player.instruction) fail(409, 'PHASE_MISMATCH', '请先确认个人指令');
      player.tutorial = true;
      if (all('tutorial')) state.phase = 'map';
      return;
    case 'enter':
      requirePhase('map');
      if (body.chapter !== state.chapter) fail(409, 'PHASE_MISMATCH', '地点已变化');
      player.entered = true;
      if (all('entered')) state.phase = 'story';
      return;
    case 'read':
      requirePhase('story');
      if (body.chapter !== state.chapter) fail(409, 'PHASE_MISMATCH', '地点已变化');
      player.read = true;
      if (all('read')) state.phase = 'event';
      return;
    case 'start':
      requirePhase('event');
      if (player.attempt) fail(409, 'ACTION_POINT_USED', '本地点行动机会已使用');
      if (!['int', 'str'].includes(body.data.type)) fail(400, 'INVALID_INPUT', '事件类型错误');
      player.attempt = {
        id: randomUUID(), type: body.data.type, startedAt: now,
        duration: body.data.type === 'int' ? rules.intelligenceMs : rules.strengthMs,
        answers: [null, null, null], sequence: body.data.type === 'str' ? Array.from({ length: 10 }, () => randomInt(3)) : [],
        used: [], hits: 0, inputSeq: -1, done: false, score: null, reward: 0, abandoned: false
      };
      return;
  }
  const attempt = player.attempt;
  if (!attempt || attempt.id !== body.attemptId || attempt.done) fail(409, 'ATTEMPT_ENDED', '尝试已结束或编号不符');
  requirePhase('event');
  if (inputKinds.includes(body.kind)) {
    if (body.inputSeq <= attempt.inputSeq) fail(409, 'STALE_INPUT', '输入序号已过期');
    if (body.kind === 'answers') {
      if (attempt.type !== 'int' || !Array.isArray(body.data.answers) || body.data.answers.length !== 3
        || body.data.answers.some(value => value !== null && (!Number.isInteger(value) || value < 0 || value > 2))) {
        fail(400, 'INVALID_INPUT', '答案格式错误');
      }
      attempt.answers = body.data.answers;
    } else {
      const { opportunity, zone } = body.data;
      if (attempt.type !== 'str' || !Number.isInteger(opportunity) || opportunity < 0 || opportunity > 9
        || !Number.isInteger(zone) || zone < 0 || zone > 2) fail(400, 'INVALID_INPUT', '目标输入错误');
      const age = elapsed(attempt, now) - rules.warmupMs - opportunity * rules.intervalMs;
      if (age < 0 || age >= rules.windowMs) fail(409, 'OPPORTUNITY_CLOSED', '该目标不在有效时间窗口');
      if (attempt.used.includes(opportunity)) fail(409, 'OPPORTUNITY_USED', '该机会已触控');
      attempt.used.push(opportunity);
      if (attempt.sequence[opportunity] === zone) attempt.hits++;
    }
    attempt.inputSeq = body.inputSeq;
    return;
  }
  if (body.kind === 'finish' && attempt.type === 'str' && elapsed(attempt, now) < attempt.duration) {
    fail(409, 'ATTEMPT_RUNNING', '事件尚未结束');
  }
  finish(state, document.seat, rewards, now, body.kind === 'abandon');
}

// Gameplay uses the same compare-and-commit boundary for native PG and cloud RPC.
export class GameplayService {
  constructor(rooms, clock = Date.now) {
    this.rooms = rooms;
    this.clock = clock;
  }

  async enter(body, joining = false) {
    const result = await this.rooms.enter(body, joining);
    return { ...result, snapshot: await this.state(result.id, body.recoverySecret) };
  }

  async load(room, token, requestId) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof room !== 'string') {
      fail(401, 'INVALID_CREDENTIAL', '本人凭证无效');
    }
    const document = await this.rooms.loadGame(room, token, requestId);
    if (document.contentVersion !== CONTENT_VERSION) fail(400, 'CONTENT_VERSION_UNSUPPORTED', '内容版本不受支持');
    document.state ||= initialState();
    return document;
  }

  async current(room, token) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const document = await this.load(room, token);
      const rewards = [];
      if (!settleExpired(document.state, rewards, this.clock())) return document;
      const result = await this.rooms.commitGame(document, token, rewards);
      if (!result.conflict) {
        document.version = result.appliedVersion;
        return document;
      }
    }
    fail(503, 'TEMPORARILY_UNAVAILABLE', '状态繁忙，请稍后重试');
  }

  async state(room, token) {
    return gameSnapshot(await this.current(room, token), this.clock());
  }

  async instruction(room, token) {
    const document = await this.current(room, token);
    const role = document.state.players[document.seat].role;
    if (!role) fail(409, 'PHASE_MISMATCH', '个人指令尚未生成');
    return { title: '个人指令', text: instructions[role] };
  }

  async action(body, token) {
    validateAction(body);
    const payload = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
    // Settle deadlines before validating phase/version, so late writes cannot revive an attempt.
    await this.current(body.room, token);
    for (let attempt = 0; attempt < 5; attempt++) {
      const document = await this.load(body.room, token, body.requestId);
      if (document.receipt) {
        if (document.receipt.payload !== payload) fail(409, 'REQUEST_ID_CONFLICT', '请求编号已用于不同参数');
        return { replayed: true, appliedVersion: document.receipt.appliedVersion, snapshot: gameSnapshot(document, this.clock()) };
      }
      const rewards = [];
      // A deadline may pass during a gateway round trip. Commit it independently of a rejected action.
      if (settleExpired(document.state, rewards, this.clock())) {
        await this.rooms.commitGame(document, token, rewards);
        continue;
      }
      apply(document.state, document, body, rewards, this.clock());
      const result = await this.rooms.commitGame(document, token, rewards, body.requestId, payload);
      if (!result.conflict) return { replayed: result.replayed, appliedVersion: result.appliedVersion,
        snapshot: await this.state(body.room, token) };
    }
    fail(503, 'TEMPORARILY_UNAVAILABLE', '状态繁忙，请稍后重试');
  }
}
