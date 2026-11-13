import { randomUUID } from 'node:crypto';
import { ApiError } from './rooms.js';
import { initialCooperative, applyCooperative, settleCooperative, cooperativeSnapshot } from './cooperative.js';
import { createRun, step, reward as alleyReward, map, checkpoints, exit, guards, lamps, STEP_MS, DURATION } from '../../../web/src/games/back-alley.js';

export const CHAPTER_RULES = 'chapter-games-1';
export const chapterInputs = ['judge', 'alley_move', 'coop_role', 'coop_ready', 'coop_move', 'coop_light', 'coop_escape'];
const fail = (code, message, status = 409) => { throw new ApiError(status, code, message); };

export function beginCooperation(state) {
  const initial = initialCooperative();
  state.cooperation = { phase: initial.phase, game: initial.coop };
  state.players.forEach(player => {
    player.coopRole = null;
    player.coopReady = false;
    player.attempt = { id: initial.coop.id, gameId: 'chapter-2-cooperative', type: 'coop',
      duration: 180000, startedAt: null, done: false, inputSeq: -1, reward: 0 };
  });
}

function cooperationState(state) {
  return { phase: state.cooperation.phase, coop: state.cooperation.game,
    players: state.players.map(player => ({ int: player.int, str: player.str, role: player.coopRole, ready: player.coopReady })) };
}

function saveCooperation(state, projected) {
  state.cooperation.phase = projected.phase;
  state.cooperation.game = projected.coop;
  state.players.forEach((player, index) => {
    const counterpart = projected.players[index];
    player.int = counterpart.int;
    player.str = counterpart.str;
    player.coopRole = counterpart.role;
    player.coopReady = counterpart.ready;
    Object.assign(player.attempt, { startedAt: projected.coop.startedAt, done: projected.coop.done,
      reward: projected.coop.reward, score: projected.coop.found.length,
      elapsed: projected.coop.done ? Math.min(180000, projected.coop.endedAt - projected.coop.startedAt) : 0 });
  });
  if (projected.coop.done) state.phase = 'invest';
}

function finishIndividual(state, seat, rewards, now, abandoned = false) {
  const player = state.players[seat];
  const attempt = player.attempt;
  if (attempt.done) return;
  const amount = attempt.type === 'str' ? alleyReward(attempt.run)
    : attempt.solved ? [10, 6, 3][attempt.guesses.length - 1] : 0;
  Object.assign(attempt, { done: true, reward: amount, abandoned,
    elapsed: Math.min(attempt.duration, Math.max(0, now - attempt.startedAt)) });
  player[attempt.type] += amount;
  rewards.push({ seat, attemptId: attempt.id, attribute: attempt.type, amount });
  if (state.players.every(item => item.attempt?.done)) state.phase = 'invest';
}

// Leave the current time slot open for a movement input. Past slots are simulated as idle.
function advanceAlley(attempt, now, includeCurrent = false) {
  const age = Math.max(0, now - attempt.startedAt);
  const target = Math.min(DURATION / STEP_MS, Math.max(0, Math.floor(age / STEP_MS) - (includeCurrent ? 0 : 1)));
  const before = attempt.run.tick;
  while (!attempt.run.done && attempt.run.tick < target) step(attempt.run);
  return before !== attempt.run.tick;
}

export function settleChapterGames(state, rewards, now) {
  if (state.cooperation) {
    const projected = cooperationState(state);
    if (!settleCooperative(projected, now, rewards)) return false;
    projected.coop.endedAt = now;
    saveCooperation(state, projected);
    return true;
  }
  let changed = false;
  state.players.forEach((player, seat) => {
    const attempt = player.attempt;
    if (!attempt || attempt.done) return;
    const expired = now >= attempt.startedAt + attempt.duration;
    if (attempt.run) changed = advanceAlley(attempt, now, expired) || changed;
    if (expired || attempt.run?.done) {
      finishIndividual(state, seat, rewards, now);
      changed = true;
    }
  });
  return changed;
}

export function applyChapterGame(state, document, body, rewards, now) {
  const player = state.players[document.seat];
  if (state.phase !== 'event') fail('PHASE_MISMATCH', '当前阶段不允许小游戏操作');
  if (body.kind === 'start') {
    if (state.chapter !== 0) fail('WRONG_GAME', '第二章请双方选择协作分工');
    if (player.attempt) fail('ACTION_POINT_USED', '本章行动机会已使用');
    if (!['int', 'str'].includes(body.data.type)) fail('INVALID_INPUT', '小游戏类型无效', 400);
    player.attempt = { id: randomUUID(), gameId: body.data.type === 'int' ? 'chapter-1-intelligence' : 'chapter-1-strength',
      type: body.data.type, startedAt: now, duration: 90000, inputSeq: -1, done: false, reward: 0,
      ...(body.data.type === 'int' ? { guesses: [], solved: false } : { run: createRun() }) };
    return;
  }
  const attempt = player.attempt;
  if (!attempt || attempt.id !== body.attemptId || attempt.done) fail('ATTEMPT_ENDED', '尝试已结束或编号不符');
  if (chapterInputs.includes(body.kind) && body.inputSeq <= attempt.inputSeq) fail('STALE_INPUT', '输入序号已过期');
  if (state.chapter === 1) {
    if (!body.kind.startsWith('coop_') || !state.cooperation) fail('WRONG_GAME', '第二章仅支持双人协作');
    const projected = cooperationState(state);
    applyCooperative(projected, document.seat, document.playerCount, body.kind.slice(5), body.data, now, rewards);
    if (projected.coop.done) projected.coop.endedAt = now;
    saveCooperation(state, projected);
  } else if (body.kind === 'judge') {
    if (attempt.type !== 'int' || !['su', 'mai', 'chen'].includes(body.data.suspectId)) fail('INVALID_INPUT', '人物选择无效', 400);
    if (attempt.guesses.includes(body.data.suspectId)) fail('SUSPECT_EXCLUDED', '此人已判断，不能重复消耗机会');
    attempt.guesses.push(body.data.suspectId);
    if (body.data.suspectId === 'chen') {
      attempt.solved = true;
      finishIndividual(state, document.seat, rewards, now);
    }
  } else if (body.kind === 'alley_move') {
    if (!attempt.run || !Object.hasOwn({ up: 1, down: 1, left: 1, right: 1 }, body.data.direction)) fail('INVALID_INPUT', '移动方向无效', 400);
    const target = Math.min(DURATION / STEP_MS, Math.floor((now - attempt.startedAt) / STEP_MS));
    if (attempt.run.tick >= target) fail('MOVE_COOLDOWN', '移动尚未就绪');
    advanceAlley(attempt, now);
    step(attempt.run, body.data.direction);
    if (attempt.run.done) finishIndividual(state, document.seat, rewards, now);
  } else if (body.kind === 'abandon') {
    finishIndividual(state, document.seat, rewards, now, true);
  } else fail('INVALID_INPUT', '请按当前小游戏规则完成操作', 400);
  attempt.inputSeq = body.inputSeq ?? attempt.inputSeq;
}

export function chapterGameSnapshot(document, now) {
  const state = document.state;
  const attempt = state.players[document.seat].attempt;
  return {
    ...(attempt ? { attempt: { ...attempt, elapsed: attempt.done ? attempt.elapsed : attempt.startedAt === null ? 0 : Math.min(attempt.duration, Math.max(0, now - attempt.startedAt)) } } : {}),
    ...(attempt?.run ? { alley: { map, checkpoints, exit, guards, lamps, stepMs: STEP_MS } } : {}),
    ...(state.cooperation ? { cooperative: cooperativeSnapshot({ ...document, state: cooperationState(state) }, now) } : {}),
    questions: null,
  };
}
