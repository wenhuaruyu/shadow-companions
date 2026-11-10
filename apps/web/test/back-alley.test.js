import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step, reward, DURATION, STEP_MS, directions } from '../src/games/back-alley.js';
test('后巷触屏规则可在90秒内依次经过两个检查点通关', () => {
  const queue = [createRun()], seen = new Set();
  let winner;
  for (let index=0;index<queue.length;index++) {
    const run=queue[index];
    if(run.checkpoint===3){winner=run;break;}
    if(run.done)continue;
    for(const direction of [null,...Object.keys(directions)]){
      const next=step(structuredClone(run),direction);
      if(next.caught)continue;
      const key=[...next.position,next.checkpoint,next.tick%72].join(',');
      if(!seen.has(key)){seen.add(key);queue.push(next);}
    }
  }
  assert.ok(winner);
  assert.ok(winner.tick*STEP_MS<DURATION);
  assert.equal(reward(winner),10);
});
test('计时、灯光受阻、保存恢复与四档奖励',()=>{
  const run=createRun();run.position=[3,1];run.tick=8;
  step(run);assert.equal(run.caught,1);assert.deepEqual(run.position,[1,1]);
  const restored=JSON.parse(JSON.stringify(run));
  for(let i=0;i<30;i++){step(run);step(restored);}
  assert.deepEqual(restored,run);
  for(const [checkpoint,value] of [[0,0],[1,3],[2,6],[3,10]])assert.equal(reward({checkpoint}),value);
  const timed=createRun();for(let i=0;i<450;i++)step(timed);
  assert.equal(timed.done,true);assert.equal(timed.tick,450);
});
