const segments = [
 ['h',0,1,10],['h',10,0,9],['v',0,0,10],['v',10,0,10],
 ['h',1,1,4],['v',5,0,1],['h',1,5,7],['h',1,8,9],
 ['v',8,1,6],['h',2,1,3],['v',2,2,3],['v',4,1,3],
 ['h',2,4,8],['v',6,2,3],['h',3,6,7],['v',7,3,5],
 ['h',3,0,1],['v',1,3,4],['h',4,1,2],['v',2,4,7],
 ['v',3,3,5],['h',4,3,6],['v',5,3,4],['v',9,2,5],
 ['h',5,5,7],['v',6,5,8],['v',1,5,6],['h',6,2,3],
 ['v',4,5,7],['h',6,4,5],['h',6,7,9],['h',7,1,2],
 ['v',1,7,9],['h',7,3,4],['v',3,7,10],['h',7,6,9],
 ['v',9,7,8],['h',8,2,3],['v',5,7,9],['h',8,5,6],
 ['v',4,8,9],['h',9,1,2],['h',9,4,7],['h',8,7,8],
 ['v',8,8,9],['h',9,8,9],['h',8,9,10],
];
const walls = segments.flatMap(([axis, line, from, to]) =>
  Array.from({ length: to - from }, (_, index) => axis === 'h'
    ? { from: [from + index, line], to: [from + index + 1, line] }
    : { from: [line, from + index], to: [line, from + index + 1] }));
const blockedEdges = new Set(walls.map(wall => wall.from[1] === wall.to[1]
  ? `h:${wall.from[1]}:${wall.from[0]}`
  : `v:${wall.from[0]}:${wall.from[1]}`));
function blocked(from, to) {
  if (to.some(value => value < 0 || value >= 10)) return true;
  const [x, y] = from;
  const [nextX, nextY] = to;
  const edge = x === nextX ? `h:${Math.max(y, nextY)}:${x}` : `v:${Math.max(x, nextX)}:${y}`;
  return blockedEdges.has(edge);
}

export const referenceLayout = Object.freeze({
  grid: Array(10).fill('..........'),
  start: [0, 0],
  exit: [9, 9],
  walls,
  people: [[5, 0], [6, 2], [0, 3], [4, 8], [9, 7]].map((position, id) => ({
    id, position, color: ['#e96969', '#eab84c', '#60b88c', '#5da6df', '#d69965'][id],
  })),
});
export function referenceCanMove(from, to) {
  return Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1 && !blocked(from, to);
}
