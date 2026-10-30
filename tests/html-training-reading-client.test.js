import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingMeter,mountReadingTracker} from '../src/html-training-reading.js';
import {buildReadingPlan} from '../worker-training/reading-plan.js';
import {startReading,readingProgress} from '../worker-training/reading-state.js';
const plan={blocks:[{section:0,requiredMs:2000},{section:0,requiredMs:2000},{section:1,requiredMs:1000}]};
test('reading meter spends each active millisecond once even when several blocks are visible',()=>{
 const meter=createReadingMeter(plan,[0,0,0]);meter.tick(1000,{active:true,visible:[0,1]});meter.tick(1000,{active:true,visible:[0,1]});
 assert.deepEqual(meter.batch(60000),[[0,2000]]);assert.equal(meter.sectionComplete(0),false);
 meter.ack([[0,2000]],[2000,0,0]);assert.equal(meter.sectionComplete(0),false);
 meter.tick(1000,{active:true,visible:[1]});meter.tick(1000,{active:true,visible:[1]});meter.ack([[1,2000]],[2000,2000,0]);assert.equal(meter.sectionComplete(0),true);
});
test('hidden or unfocused time and long timer gaps cannot complete reading',()=>{
 const meter=createReadingMeter(plan,[0,0,0]);meter.tick(50000,{active:false,visible:[0,1]});assert.deepEqual(meter.batch(60000),[]);
 meter.tick(50000,{active:true,visible:[0,1]});assert.deepEqual(meter.batch(60000),[[0,1000]]);
});
test('acknowledging an in-flight batch retains newly earned time and respects server budget',()=>{
 const meter=createReadingMeter(plan,[0,0,0]);meter.tick(1000,{active:true,visible:[0]});const sent=meter.batch(500);assert.deepEqual(sent,[[0,500]]);
 meter.tick(1000,{active:true,visible:[0]});meter.ack(sent,[500,0,0]);assert.deepEqual(meter.batch(60000),[[0,1500]]);assert.equal(meter.sectionComplete(0),false);
});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function trackerFixture({loseResponse=false,wide=false,innerScroller=false}={}){
 let now=50000,interval,focused=true,offscreen=false,hidden=false,collapsed=false,pan=0,clipped=innerScroller,calls=0,lastProgress;
 const text=Array(60).fill('um').join(' '),readingPlan=buildReadingPlan([{html:'<p>'+text+'</p>'}]);
 const inner={parentElement:null,getBoundingClientRect:()=>({left:0,right:clipped?0:400,top:0,bottom:600})};
 const node={nodeType:3,nodeValue:text,childNodes:[],parentElement:innerScroller?inner:null},material={nodeType:1,tagName:'MAIN',childNodes:[node]},details={open:false};
 const listeners={addEventListener(){},removeEventListener(){}};
 const doc={...listeners,defaultView:{getComputedStyle:()=>({overflowX:'hidden',overflowY:'hidden'})},querySelector:()=>material,querySelectorAll:()=>[details],createRange:()=>({setStart(){},setEnd(){},getClientRects:()=>collapsed?[]:[{left:-pan,right:(wide?1000:300)-pan,top:offscreen?1200:0,bottom:offscreen?1240:40,width:wide?1000:300,height:40}]})};
 const parent={...listeners,get visibilityState(){return hidden?'hidden':'visible';},hasFocus:()=>focused,defaultView:{innerWidth:400,innerHeight:600,setInterval(fn){interval=fn;return 1;},clearInterval(){interval=null;},getComputedStyle:()=>({})}};
 const frame={ownerDocument:parent,contentDocument:doc,parentElement:null,getBoundingClientRect:()=>({left:0,right:400,top:0,bottom:600})};
 const state={run:{id:'reading-run',stage:'READING',readCount:0}},errors=[];
 const tracker=mountReadingTracker({frame,plan:readingPlan,section:0,runId:'reading-run',clock:()=>now,
  call:async(action,input)=>{calls++;if(action==='READING_START')startReading(state.run,readingPlan,input,now);else{readingProgress(state.run,readingPlan,input,now);if(loseResponse){loseResponse=false;throw Error('response lost');}}return {state:structuredClone(state)};},
  onState(){},onUpdate:p=>lastProgress=p,onError:e=>errors.push(e)});
 await settle();
 return {tracker,state,details,errors,get progress(){return lastProgress;},get calls(){return calls;},focus:v=>focused=v,hidden:v=>hidden=v,offscreen:v=>offscreen=v,collapse:v=>collapsed=v,pan:v=>pan=v,clip:v=>clipped=v,async advance(seconds){for(let i=0;i<seconds;i++){now+=1000;interval?.();await settle();}}};
}
test('real tracker pauses hidden, unfocused and offscreen exposure, then unlocks after validated full reading',async()=>{
 const h=await trackerFixture();assert.equal(h.details.open,true);h.hidden(true);await h.advance(4);h.hidden(false);h.focus(false);await h.advance(4);h.focus(true);h.offscreen(true);await h.advance(4);
 await h.tracker.flush();assert.deepEqual(h.state.run.reading.credits,[0,0]);
 h.offscreen(false);await h.advance(18);await h.tracker.flush();assert.deepEqual(h.state.run.reading.credits,[9000,9000]);assert.equal(h.progress.complete,true);assert.deepEqual(h.errors,[]);
 const before=h.calls;h.tracker.cleanup();await h.advance(30);assert.equal(h.calls,before);
});
test('tracker retries a lost acknowledgement with the same batch instead of awarding elapsed time twice',async()=>{
 const h=await trackerFixture({loseResponse:true});await h.advance(9);await h.tracker.flush();assert.deepEqual(h.state.run.reading.credits,[9000,0]);
 await h.tracker.flush();assert.deepEqual(h.state.run.reading.credits,[9000,0]);assert.equal(h.state.run.reading.sequence,1);assert.deepEqual(h.errors,[]);h.tracker.cleanup();
});
test('collapsed reference text with no layout rectangles never earns reading time',async()=>{
 const h=await trackerFixture();h.collapse(true);await h.advance(18);await h.tracker.flush();assert.deepEqual(h.state.run.reading.credits,[0,0]);h.tracker.cleanup();
});
test('horizontal traversal makes wide text reachable on a narrow screen',async()=>{
 const h=await trackerFixture({wide:true});await h.advance(1);h.pan(300);await h.advance(1);h.pan(600);await h.advance(18);await h.tracker.flush();assert.equal(h.progress.complete,true);h.tracker.cleanup();
});
test('content clipped by a scroller inside the iframe is not treated as visible',async()=>{
 const h=await trackerFixture({innerScroller:true});await h.advance(18);await h.tracker.flush();assert.deepEqual(h.state.run.reading.credits,[0,0]);h.clip(false);await h.advance(18);await h.tracker.flush();assert.equal(h.progress.complete,true);h.tracker.cleanup();
});
