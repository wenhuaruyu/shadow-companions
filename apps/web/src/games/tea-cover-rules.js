export const phases = [
  { name: '前队入林', story: '前队正在穿过茶林。注意茶丛与石墙后的敌方，稳住准星。', count: 24, exposure: 1500 },
  { name: '掩护接应', story: '接应队员正在穿过阵地。认准蓝色标识，放自己人通过。', count: 32, exposure: 1300 },
  { name: '最后撤离', story: '最后一批人员即将进入密林。追兵逼近，守住岔口！', count: 40, exposure: 1100 },
];
export const positions = [[15, 53], [34, 62], [54, 51], [76, 61], [89, 80], [58, 85], [25, 84]];
export const enemyTotal = 78;
export const shotInterval = 350;
export const directions = { up: { arrow: '↑', text: '向上滑动', x: 0, y: -9 }, down: { arrow: '↓', text: '向下滑动', x: 0, y: 9 }, left: { arrow: '←', text: '向左滑动', x: -9, y: 0 }, right: { arrow: '→', text: '向右滑动', x: 9, y: 0 } };
export function buildSchedule() {
  const schedule = [];
  for (const [index, phase] of phases.entries()) {
    // Guarantee a mix of wave sizes, then randomize their order and timing.
    const waves = [1, 2, 3];
    let remaining = phase.count - 6;
    const choices = index === 0 ? [1, 1, 2, 2, 3] : index === 1 ? [1, 2, 2, 3, 3] : [1, 2, 3, 3, 3];
    while (remaining > 0) {
      const size = Math.min(remaining, choices[Math.floor(Math.random() * choices.length)]);
      waves.push(size);
      remaining -= size;
    }
    const minimumGap = phase.exposure + 100;
    const availableTime = 40000 - phase.exposure - 300;
    const maximumWaves = Math.floor(availableTime / minimumGap) + 1;
    while (waves.length > maximumWaves) {
      const first = waves.indexOf(1);
      const second = waves.findIndex((size, i) => i !== first && size <= 2);
      waves[first] += waves[second];
      waves.splice(second, 1);
    }
    for (let i = waves.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [waves[i], waves[j]] = [waves[j], waves[i]];
    }
    const gaps = waves.slice(1).map(() => .6 + Math.random() * .8);
    const gapTotal = gaps.reduce((sum, gap) => sum + gap, 0);
    const extraTime = availableTime - minimumGap * gaps.length;
    const friendlyFlags = Array.from({ length: phase.count }, (_, slot) => index > 0 && (slot + 1) % 4 === 0);
    for (let i = friendlyFlags.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [friendlyFlags[i], friendlyFlags[j]] = [friendlyFlags[j], friendlyFlags[i]];
    }
    let at = index * 40000;
    let slot = 0;
    for (const [wave, size] of waves.entries()) {
      const available = positions.map((_, i) => i);
      for (let member = 0; member < size; member++) {
        const chosen = Math.floor(Math.random() * available.length);
        const [position] = available.splice(chosen, 1);
        schedule.push({ id: schedule.length, at, exposure: phase.exposure, friendly: friendlyFlags[slot++], position });
      }
      if (wave < gaps.length) at += minimumGap + gaps[wave] / gapTotal * extraTime;
    }
  }
  return schedule;
}


export function buildDodges() {
  const cues = [];
  let at = 8000 + Math.random() * 4000;
  const names = Object.keys(directions);
  while (at < 117500) {
    const windowMs = [1800, 1500, 1200][Math.floor(at / 40000)];
    cues.push({ id: cues.length, at, direction: names[Math.floor(Math.random() * names.length)], windowMs });
    at += windowMs + 8000 + Math.random() * 5000;
  }
  return cues;
}
export function coverReward(hits, friendlyHits, empty, wounds) {
  const effective = Math.max(0, hits - friendlyHits * 3 - empty * .5 - wounds * 3);
  const rate = effective / enemyTotal;
  return { effective, rate, reward: rate >= .8 ? 10 : rate >= .4 ? 5 : 0 };
}
