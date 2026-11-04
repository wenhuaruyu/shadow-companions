import { randomUUID, randomInt } from 'node:crypto';
export const questions = [
 [['灯＝竹，窗＝海，门＝舟。窗对应哪个字？',['竹','海','舟'],1],['口令按灯、窗、门排列，哪组正确？',['竹海舟','海竹舟','舟海竹'],0],['有效联络笺须圆印和双折角。该选哪张？',['圆印单折','方印双折','圆印双折'],2]],
 [['一号去西岸，二号去北岸，三号去东岸。去北岸选哪船？',['一号','二号','三号'],1],['先人员、再行李、最后联络袋。第二批是什么？',['人员','行李','联络袋'],1],['凭据须船号二且带圆印。哪张可用？',['二号方印','一号圆印','二号圆印'],2]]
];
export const rooms = new Map();
const fail=(message)=>{throw new Error(message)};
export function create(){const r={id:randomUUID(),version:1,created:Date.now(),chapter:0,phase:'lobby',players:[],records:[],ended:false};rooms.set(r.id,r);return r;}
export function join(r){if(r.ended||Date.now()-r.created>900000&&r.players.length<2)fail('邀请已失效');if(r.players.length===2)fail('本次行动已有两名玩家');const p={token:randomUUID(),name:r.players.length?'顾宁':'林舟',int:5,str:5,ready:false,instruction:false,tutorial:false,entered:false,read:false,continued:false,attempt:null,investment:null,last:Date.now(),visible:true};r.players.push(p);return p;}
export function player(r,t){return r.players.find(p=>p.token===t)||fail('本人凭证无效');}
export function paused(r){return !r.ended&&r.phase!=='lobby'&&r.players.some(p=>!p.visible||Date.now()-p.last>7000);}
export function tick(r){const now=Date.now();const delta=Math.min(now-(r.tick||now),1500);r.tick=now;if(!r.ended&&r.phase!=='lobby'&&r.players.some(p=>now-p.last>120000||p.away&&now-p.away>120000)){r.ended=true;r.phase='ended';r.reason='连接中断超过120秒，行动已结束';}if(!paused(r))for(const p of r.players){const a=p.attempt;if(a&&!a.done){a.elapsed+=delta;if(a.elapsed>=a.duration)finish(r,p);}}}
function finish(r,p){const a=p.attempt;if(a.done)return;const score=a.type==='int'?questions[r.chapter].reduce((n,q,i)=>n+(a.answers[i]===q[2]),0):a.hits; a.reward=a.type==='int'?[0,3,6,10][score]:score;a.score=score;a.done=true;p[a.type]+=a.reward;if(r.players.every(x=>x.attempt?.done))r.phase='invest';}
export function view(r,p){return {id:r.id,version:r.version,chapter:r.chapter,phase:r.phase,paused:paused(r),reason:r.reason,records:r.records,players:r.players.map(x=>({name:x.name,int:x.int,str:x.str,ready:x.ready,instruction:x.instruction,tutorial:x.tutorial,entered:x.entered,read:x.read,continued:x.continued,online:x.visible&&Date.now()-x.last<7000,event:x.attempt?{type:x.attempt.type,done:x.attempt.done,reward:x.attempt.reward}:null,investment:x.investment})),me:r.players.indexOf(p),attempt:p.attempt?{...p.attempt}:null,questions:p.attempt?.type==='int'?questions[r.chapter].map(q=>({text:q[0],options:q[1]})):null};}
export function act(r,p,kind,data={}){tick(r);if(kind==='presence'){p.last=Date.now();p.visible=data.visible!==false;if(!p.visible)p.away ||= Date.now();else p.away=null;return;}if(r.ended)fail('对局已结束');if(kind!=='exit'&&paused(r))fail('对局暂停，等待同伴恢复');const all=(key)=>r.players.length===2&&r.players.every(x=>x[key]);
 if(kind==='ready'){if(r.phase!=='lobby')return;p.ready=!p.ready;if(all('ready')){const traitor=randomInt(2);r.players.forEach((x,i)=>x.role=i===traitor?'secret':'courier');r.phase='brief';}}
 else if(kind==='instruction'){if(r.phase!=='brief')fail('阶段不符');p.instruction=true;}
 else if(kind==='tutorial'){if(!p.instruction||r.phase!=='brief')fail('请先确认个人指令');p.tutorial=true;if(all('tutorial'))r.phase='map';}
 else if(kind==='enter'){if(r.phase!=='map')fail('阶段不符');p.entered=true;if(all('entered'))r.phase='story';}
 else if(kind==='read'){if(r.phase!=='story')fail('阶段不符');p.read=true;if(all('read'))r.phase='event';}
 else if(kind==='start'){if(r.phase!=='event')fail('阶段不符');if(p.attempt)return;if(!['int','str'].includes(data.type))fail('输入非法');p.attempt={id:randomUUID(),type:data.type,elapsed:0,duration:data.type==='int'?60000:22200,answers:[],sequence:Array.from({length:10},()=>randomInt(3)),used:[],hits:0,done:false};}
 else if(kind==='answers'){if(!p.attempt||p.attempt.done||p.attempt.type!=='int')fail('尝试已结束');if(!Array.isArray(data.answers)||data.answers.length>3||data.answers.some(v=>v!==null&&(!Number.isInteger(v)||v<0||v>2)))fail('输入非法');p.attempt.answers=data.answers;}
 else if(kind==='hit'){const a=p.attempt;if(!a||a.done||a.type!=='str')fail('尝试已结束');const i=Math.floor((a.elapsed-3000)/2000);if(i>=0&&i<10&&(a.elapsed-3000)%2000<1200&&!a.used.includes(i)){a.used.push(i);if(a.sequence[i]===data.zone)a.hits++;}}
 else if(kind==='finish'){if(!p.attempt)fail('尚未开始');if(p.attempt.type==='str'&&p.attempt.elapsed<p.attempt.duration)fail('事件尚未结束');finish(r,p);}
 else if(kind==='invest'){if(p.investment)return;if(r.phase!=='invest')fail('阶段不符');for(const k of ['int','str'])if(!Number.isInteger(data[k])||data[k]<0||data[k]>p[k])fail('投入必须为余额以内的非负整数');p.investment={int:data.int,str:data.str};p.int-=data.int;p.str-=data.str;if(all('investment')){const sums=r.players.reduce((a,x)=>({int:a.int+x.investment.int,str:a.str+x.investment.str}),{int:0,str:0});const need=r.chapter?{int:6,str:4}:{int:5,str:5};const success=sums.int>=need.int&&sums.str>=need.str;r.records.push({chapter:r.chapter,success,sums,need,investments:r.players.map(x=>({...x.investment}))});r.phase='result';}}
 else if(kind==='continue'){if(r.phase!=='result')fail('阶段不符');p.continued=true;if(all('continued')){if(!r.records.at(-1).success){r.phase='failed';r.ended=true;}else if(r.chapter===1){r.phase='complete';r.ended=true;}else{r.chapter=1;r.phase='map';r.players.forEach(x=>Object.assign(x,{entered:false,read:false,continued:false,attempt:null,investment:null}));}}}
 else if(kind==='exit'){r.phase='ended';r.ended=true;r.reason='一位交通员退出，当前行动已结束';}
 else fail('未知操作');r.version++;
}
