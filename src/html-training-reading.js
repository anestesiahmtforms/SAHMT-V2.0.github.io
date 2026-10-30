import {readingImage,readingSignature} from './html-training-reading-shared.js';

export function createReadingMeter(plan,credits=[]){
 let confirmed=plan.blocks.map((_,i)=>credits[i]||0),pending=plan.blocks.map(()=>0);
 return {
  tick(elapsed,{active,visible}){
   if(!active)return;
   let budget=Math.max(0,Math.min(1000,Math.floor(elapsed)));
   for(const i of visible){const room=plan.blocks[i].requiredMs-confirmed[i]-pending[i],add=Math.min(room,budget);if(add>0){pending[i]+=add;budget-=add;}if(!budget)break;}
  },
  batch(maximum){let budget=Math.max(0,Math.min(60000,Math.floor(maximum))),rows=[];for(let i=0;i<pending.length&&budget;i++){const n=Math.min(pending[i],budget);if(n){rows.push([i,n]);budget-=n;}}return rows;},
  ack(rows,credits){for(const [i,n]of rows)pending[i]=Math.max(0,pending[i]-n);confirmed=plan.blocks.map((_,i)=>credits[i]||0);},
  sectionComplete(section){return plan.blocks.every((b,i)=>b.section!==section||confirmed[i]>=b.requiredMs);},
  locallyComplete(section){return plan.blocks.every((b,i)=>b.section!==section||confirmed[i]+pending[i]>=b.requiredMs);},
  progress(section){const pairs=plan.blocks.map((b,i)=>({b,i})).filter(x=>x.b.section===section),required=pairs.reduce((n,x)=>n+x.b.requiredMs,0),saved=pairs.reduce((n,x)=>n+confirmed[x.i],0),earned=pairs.reduce((n,x)=>n+confirmed[x.i]+pending[x.i],0);return {percent:required?Math.floor(saved/required*100):100,remainingMs:Math.max(0,required-earned)};}
 };
}

function readingDomNodes(root){
 const nodes=[];
 function visit(node){
  if(node.nodeType===3&&node.nodeValue.trim())nodes.push({node,kind:'text',signature:readingSignature('text',node.nodeValue)});
  else if(node.nodeType===1&&node.tagName==='IMG'){
   const attrs=Object.fromEntries([...node.attributes].map(a=>[a.name,a.value]));if(readingImage(attrs))nodes.push({node,kind:'image',signature:readingSignature('image',attrs.src||'')});
  }
  for(const child of node.childNodes||[])visit(child);
 }
 visit(root);return nodes;
}
function frameClip(frame){
 const win=frame.ownerDocument.defaultView,rect=frame.getBoundingClientRect();
 let left=Math.max(rect.left,0),top=Math.max(rect.top,0),right=Math.min(rect.right,win.innerWidth),bottom=Math.min(rect.bottom,win.innerHeight);
 for(let el=frame.parentElement;el;el=el.parentElement){const style=win.getComputedStyle(el),r=el.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}}
 return {left:left-rect.left,top:top-rect.top,right:right-rect.left,bottom:bottom-rect.top};
}

/** Owns timers/listeners for one displayed section; no timer survives cleanup. */
export function mountReadingTracker({frame,plan,section,runId,call,onState,onUpdate,onError,clock=()=>performance.now()}){
 const parent=frame.ownerDocument,doc=frame.contentDocument,win=parent.defaultView;
 let alive=true,meter,sequence=0,lastTick=clock(),lastAck=clock(),lastFlush=clock(),lastActivity=clock(),request=null,sending=null,stopped=false;
 const sessionId=crypto.randomUUID(),cleanups=[];
 const activity=()=>{lastActivity=clock();};
 const watch=(target,name,fn)=>{target.addEventListener(name,fn,{passive:true,capture:true});cleanups.push(()=>target.removeEventListener(name,fn,{capture:true}));};
 for(const target of [parent,doc])for(const name of ['scroll','pointerdown','keydown','touchstart'])watch(target,name,activity);
 doc.querySelectorAll('details').forEach(el=>{el.open=true;});
 const dom=readingDomNodes(doc.querySelector('.material')),expected=plan.nodes.map((n,i)=>({...n,index:i})).filter(n=>n.section===section),mapped=new Map();
 try{
  if(dom.length!==expected.length||expected.some((n,i)=>n.kind!==dom[i].kind||n.signature!==dom[i].signature))throw Object.assign(new Error('O conteúdo mudou. Reabra o documento para validar a leitura.'),{code:'TRAINING_READING_CONTENT_CHANGED'});
  for(const [i,n]of expected.entries())mapped.set(n.index,dom[i].node);
 }catch(error){for(const cleanup of cleanups)cleanup();onError(error);return {cleanup(){},flush:async()=>{throw error;}};}
 const targets=plan.blocks.map((block,index)=>{
  if(block.section!==section)return null;const node=mapped.get(block.node);
  if(plan.nodes[block.node].kind==='image')return {index,node,seen:new Set()};
  const range=doc.createRange();range.setStart(node,block.from);range.setEnd(node,block.to);return {index,node,range,seen:new Map()};
 }).filter(Boolean);
 const visible=()=>{
  const outerClip=frameClip(frame),result=[];
  if(outerClip.right<=outerClip.left||outerClip.bottom<=outerClip.top)return result;
  for(const target of targets){
   const clip={...outerClip};
   for(let el=target.node.parentElement;el;el=el.parentElement){
    const style=doc.defaultView.getComputedStyle(el),r=el.getBoundingClientRect();
    if(/auto|scroll|hidden|clip/.test(style.overflowY)){clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom);}
    if(/auto|scroll|hidden|clip/.test(style.overflowX)){clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right);}
   }
   if(clip.right<=clip.left||clip.bottom<=clip.top)continue;
   const rects=target.range?[...target.range.getClientRects()]:[target.node.getBoundingClientRect()];
   if(!rects.length)continue;
   const layoutWidth=doc.documentElement?.clientWidth;
   if(target.layoutWidth!==layoutWidth){target.seen.clear();target.layoutWidth=layoutWidth;}
   let area=0,shown=0,capacity=0;
   for(const [n,r]of rects.entries()){
    if(r.width<=0||r.height<=0)continue;
    area+=r.width*r.height;capacity+=Math.min(r.width,clip.right-clip.left)*Math.min(r.height,clip.bottom-clip.top);const w=Math.max(0,Math.min(r.right,clip.right)-Math.max(r.left,clip.left)),height=Math.max(0,Math.min(r.bottom,clip.bottom)-Math.max(r.top,clip.top));shown+=w*height;
    if(target.range){
     if(!target.seen.has(n))target.seen.set(n,new Set());
     if(height>=r.height*.95)for(let b=0;b<20;b++){const x=r.left+r.width*(b+.5)/20;if(x>=clip.left&&x<=clip.right)target.seen.get(n).add(b);}
    }
    else{
     // Large illustrations must be traversed from their top to their bottom.
     const bins=20;for(let b=0;b<bins;b++){const y=r.top+r.height*(b+.5)/bins;if(y>=clip.top&&y<=clip.bottom&&w>=r.width*.9)target.seen.add(b);}
    }
   }
   const covered=target.range?rects.every((r,n)=>r.width<=0||r.height<=0||target.seen.get(n)?.size===20):target.seen.size===20;
   if(covered&&area>0&&shown>0&&capacity>0&&shown>=capacity*.6)result.push(target.index);
  }
  return result;
 };
 const update=paused=>{if(alive&&meter)onUpdate({...meter.progress(section),complete:meter.sectionComplete(section),paused});};
 async function flush(){
  if(!alive||stopped||!meter)return;
  if(sending)return sending;
  if(!request){const increments=meter.batch(clock()-lastAck);if(!increments.length)return;request={runId,sessionId,sequence:sequence+1,increments};}
  sending=(async()=>{
   try{
    const result=await call('READING_PROGRESS',request);if(!alive)return;
    meter.ack(request.increments,result.state.run.reading.credits);sequence=request.sequence;request=null;lastAck=clock();onState(result.state);update(false);
   }catch(error){
    if(!alive)return;
    if(error.status===401||error.status===403||['VERSION_CHANGED','TRAINING_READING_SESSION_CHANGED','TRAINING_READING_SEQUENCE','IDEMPOTENCY_CONFLICT'].includes(error.code)){stopped=true;onError(error);}
    else update('Conecte-se para confirmar o progresso da leitura.');
   }finally{sending=null;lastFlush=clock();}
  })();
  return sending;
 }
 const timer=win.setInterval(()=>{
  const now=clock(),elapsed=now-lastTick;lastTick=now;
  if(!alive||stopped||!meter)return;
  const active=parent.visibilityState==='visible'&&parent.hasFocus()&&now-lastActivity<120000;
  meter.tick(elapsed,{active,visible:active?visible():[]});update(active?false:'Leitura pausada. Volte ao documento para continuar.');
  if(now-lastFlush>=20000||meter.locallyComplete(section)&&!meter.sectionComplete(section))void flush();
 },250);
 cleanups.push(()=>win.clearInterval(timer));
 void (async()=>{
  try{const result=await call('READING_START',{runId,sessionId});if(!alive)return;onState(result.state);meter=createReadingMeter(plan,result.state.run.reading.credits);lastTick=clock();lastAck=lastTick;update(false);}
  catch(error){if(alive){stopped=true;onError(error);}}
 })();
 return {cleanup(){alive=false;for(const cleanup of cleanups)cleanup();},async flush(){await flush();return !!meter?.sectionComplete(section);}};
}
