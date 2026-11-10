export const VERSION = 'back-alley-touch-1';
export const DURATION = 90000;
export const STEP_MS = 200;
export const map = ['##...#.######','#...........#','###.#######.#','######.####.#','#...........#','#.###########','#.#####...###','#...........#','#############'];
export const start = [1, 1];
export const checkpoints = [[11, 2], [1, 5]];
export const exit = [11, 7];
export const guards = [
  [[4,1],[5,1],[6,1],[7,1],[8,1],[7,1],[6,1],[5,1]],
  [[8,4],[7,4],[6,4],[5,4],[4,4],[5,4],[6,4],[7,4]]
];
export const lamps = [[[2,1],[3,1],[4,1],[3,1]],[[7,7],[8,7],[9,7],[8,7]]];
export const directions = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
export const same = (a, b) => a[0] === b[0] && a[1] === b[1];
export const walkable = ([x,y]) => map[y]?.[x] === '.';
export const positions = (routes, tick, period) => routes.map(route => route[Math.floor(tick / period) % route.length]);
export function createRun() {
  return { version: VERSION, tick: 0, position: [...start], checkpoint: 0, caught: 0, blockedUntil: 0, done: false };
}
export function reward(run) { return [0,3,6,10][run.checkpoint]; }
function discover(run) {
  run.position = [...(run.checkpoint ? checkpoints[run.checkpoint - 1] : start)];
  run.caught++;
  run.blockedUntil = run.tick + 3;
}
// One deterministic step. Rendering, local prediction and server replay use identical rules.
export function step(run, direction = null) {
  if (run.done) return run;
  if (direction !== null && !Object.hasOwn(directions, direction)) throw new Error('INVALID_DIRECTION');
  run.tick++;
  if (run.tick * STEP_MS >= DURATION) { run.done = true; return run; }
  const light = positions(lamps, run.tick, 9);
  if (run.tick < run.blockedUntil) return run;
  if (light.some(p => same(p, run.position))) { discover(run); return run; }
  const previousGuards = positions(guards, run.tick - 1, 3);
  const nextGuards = positions(guards, run.tick, 3);
  const delta = directions[direction];
  if (delta) {
    const next = [run.position[0] + delta[0], run.position[1] + delta[1]];
    if (walkable(next)) run.position = next;
  }
  if ([...light, ...previousGuards, ...nextGuards].some(p => same(p, run.position))) {
    discover(run); return run;
  }
  if (run.checkpoint < 2 && same(run.position, checkpoints[run.checkpoint])) run.checkpoint++;
  if (run.checkpoint === 2 && same(run.position, exit)) { run.checkpoint = 3; run.done = true; }
  return run;
}
