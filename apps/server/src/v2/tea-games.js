import { randomInt } from 'node:crypto';
import { ApiError } from './rooms.js';
import { buildSchedule, buildDodges, coverReward, shotInterval } from '../../../web/src/games/tea-cover-rules.js';

const morse = ['━━━━━', '·━━━━', '··━━━', '···━━', '····━', '·····', '━····', '━━···', '━━━··', '━━━━·'];
const answers = { A: 'west', B: 'north', C: 'south', D: 'inbox', E: 'inbox', F: 'inbox' };
const fail = message => { throw new ApiError(409, 'INVALID_TEA_ACTION', message); };
export const teaInputs = ['tea_archive', 'tea_memory', 'tea_peek', 'tea_decode', 'tea_route', 'tea_shot', 'tea_dodge'];
export function createTea(type) {
  return type === 'int'
    ? { phase: 'archive', assignments: {}, locked: [], mistakes: 0, code: String(randomInt(100, 1000)), memoryUntil: 0, peekUntil: 0, solved: false }
    : { schedule: buildSchedule(), dodges: buildDodges(), shotIds: [], dodgeIds: [], hits: 0, friendlyHits: 0, empty: 0, wounds: 0, evaded: 0, lastShot: -350 };
}
export function settleTea(attempt, now) {
  const tea = attempt.tea;
  let changed = false;
  if (attempt.type === 'int') {
    if (tea.phase === 'memory' && now >= tea.memoryUntil) { tea.phase = 'morse'; changed = true; }
  } else {
    for (const cue of tea.dodges) {
      const deadline = attempt.startedAt + cue.at + cue.windowMs + 1500;
      if (now >= deadline && !tea.dodgeIds.includes(cue.id)) {
        tea.dodgeIds.push(cue.id); tea.wounds += 1; changed = true;
      }
    }
  }
  return changed;
}
export function teaReward(attempt) {
  if (attempt.type === 'int') return attempt.tea.solved ? attempt.tea.mistakes <= 1 ? 10 : 5 : 0;
  const tea = attempt.tea;
  return coverReward(tea.hits, tea.friendlyHits, tea.empty, tea.wounds).reward;
}
export function applyTea(attempt, kind, data, now) {
  const tea = attempt.tea;
  if (kind === 'abandon') return true;
  if (attempt.type === 'int') {
    if (kind === 'tea_archive' && tea.phase === 'archive') {
      const assignments = data.assignments;
      if (!assignments || Object.keys(assignments).length !== 6 || !Object.keys(answers).every(id => ['west', 'north', 'south', 'inbox'].includes(assignments[id]))) fail('请完整归档六条情报');
      tea.assignments = { ...assignments };
      for (const [id, answer] of Object.entries(answers)) {
        if (tea.locked.includes(id)) { tea.assignments[id] = answer; continue; }
        if (assignments[id] === answer) tea.locked.push(id);
        else { tea.mistakes += 1; delete tea.assignments[id]; }
      }
      if (tea.locked.length === 6) { tea.phase = 'memory'; tea.memoryUntil = now + 20000; }
    } else if (kind === 'tea_memory' && tea.phase === 'memory') tea.phase = 'morse';
    else if (kind === 'tea_peek' && tea.phase === 'morse' && now >= tea.peekUntil) { tea.mistakes += 1; tea.peekUntil = now + 5000; }
    else if (kind === 'tea_decode' && tea.phase === 'morse' && now >= tea.peekUntil) {
      if (typeof data.code !== 'string' || !/^\d{3}$/.test(data.code)) fail('请输入三位数字');
      if (data.code === tea.code) tea.phase = 'route'; else tea.mistakes += 1;
    } else if (kind === 'tea_route' && tea.phase === 'route' && ['west', 'north', 'south'].includes(data.route)) {
      if (data.route === 'south') { tea.solved = true; tea.phase = 'ended'; return true; }
      tea.mistakes += 1;
    } else fail('当前阶段不能执行此操作');
  } else {
    const elapsed = now - attempt.startedAt;
    // Client event time allows network transit, bounded by server time and prior inputs.
    const eventTime = data.elapsed;
    if (!Number.isFinite(eventTime) || eventTime < 0 || eventTime > elapsed + 150 || elapsed - eventTime > 1500) fail('操作时间已过期，请同步游戏');
    if (kind === 'tea_shot') {
      if (eventTime - tea.lastShot < shotInterval) fail('射击尚未冷却');
      if (data.targetId !== null) {
        const target = tea.schedule.find(item => item.id === data.targetId);
        if (!target || tea.shotIds.includes(target.id) || eventTime < target.at || eventTime >= target.at + target.exposure) fail('目标已离开或已命中');
        tea.shotIds.push(target.id);
        if (target.friendly) tea.friendlyHits += 1; else tea.hits += 1;
      } else tea.empty += 1;
      tea.lastShot = eventTime;
    } else if (kind === 'tea_dodge') {
      const cue = tea.dodges.find(item => item.id === data.cueId);
      if (!cue || tea.dodgeIds.includes(cue.id) || eventTime < cue.at || eventTime >= cue.at + cue.windowMs || !['up','down','left','right'].includes(data.direction)) fail('闪避提示已结束');
      tea.dodgeIds.push(cue.id);
      if (data.direction === cue.direction) tea.evaded += 1; else tea.wounds += 1;
    } else fail('武力任务仅支持射击与闪避');
  }
  return false;
}
export function teaSnapshot(attempt, now) {
  const tea = attempt.tea;
  if (attempt.type === 'str') return { ...tea };
  return { phase: tea.phase, assignments: tea.assignments, locked: tea.locked, mistakes: tea.mistakes, solved: tea.solved,
    memoryRemaining: Math.max(0, tea.memoryUntil - now), peekRemaining: Math.max(0, tea.peekUntil - now),
    ...(tea.phase === 'morse' || tea.phase === 'route' || tea.solved ? { signal: tea.code.split('').map(digit => morse[Number(digit)]) } : {}),
    ...(tea.phase === 'route' || tea.solved ? { routeCode: tea.code } : {}) };
}
