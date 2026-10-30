import {createHash} from 'node:crypto';
import {identifier,fail} from './domain-validation.js';
export function startReading(run,plan,input,now){
 const sessionId=identifier(input.sessionId);
 if(run.reading?.hash!==plan.hash){run.readCount=0;run.stage='READING';run.reading={hash:plan.hash,credits:plan.blocks.map(()=>0)};}
 run.reading={...run.reading,sessionId,sequence:0,lastAt:now,lastBatch:null};
}
export function readingProgress(run,plan,input,now){
 const r=run.reading;
 if(!r||r.hash!==plan.hash)fail('TRAINING_READING_REQUIRED',409);
 if(input.sessionId!==r.sessionId)fail('TRAINING_READING_SESSION_CHANGED',409);
 if(!Number.isSafeInteger(input.sequence)||input.sequence<1||!Array.isArray(input.increments)||!input.increments.length||input.increments.length>2048)fail('INVALID_INPUT');
 const digest=createHash('sha256').update(JSON.stringify(input.increments)).digest('hex');
 if(input.sequence===r.sequence){if(digest!==r.lastBatch)fail('IDEMPOTENCY_CONFLICT',409);return false;}
 if(input.sequence!==r.sequence+1)fail('TRAINING_READING_SEQUENCE',409);
 let total=0;const seen=new Set();
 for(const row of input.increments){
  if(!Array.isArray(row)||row.length!==2)fail('INVALID_INPUT');
  const [index,ms]=row;
  if(!Number.isSafeInteger(index)||!plan.blocks[index]||!Number.isSafeInteger(ms)||ms<=0||seen.has(index)||r.credits[index]+ms>plan.blocks[index].requiredMs)fail('INVALID_INPUT');
  seen.add(index);total+=ms;
 }
 if(total>Math.min(60000,Math.max(0,now-r.lastAt)))fail('TRAINING_READING_TIME_INVALID',409);
 for(const [index,ms]of input.increments)r.credits[index]+=ms;
 r.sequence=input.sequence;r.lastAt=now;r.lastBatch=digest;return true;
}
export function assertReadingComplete(run,plan,section){
 if(!run.reading||run.reading.hash!==plan.hash)fail('TRAINING_READING_REQUIRED',409);
 if(plan.blocks.some((block,i)=>(section===undefined||block.section===section)&&(run.reading.credits[i]||0)<block.requiredMs))fail('TRAINING_READING_INCOMPLETE',409);
}
