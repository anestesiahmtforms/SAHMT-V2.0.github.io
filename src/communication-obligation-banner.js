import {obligationDueAt,obligationStage,registrationConvocationAffiliation,registrationConvocationScope,validateObligation} from '../communication/obligations.js';
import {activityBreadcrumb} from './communication-activity-selection.js';
import {APP_UPDATE_LOCK_EVENT} from './app-updates.js';
import {isAppUpdateRequired} from './router.js';
import './communication-obligation-banner.css';

const registrationLockAt=Date.parse('2026-11-27T00:00:00-03:00');
const isProfessional=item=>item?.activity?.kind==='SURVEY'&&item.activity.id==='professional';
const isScopedRegistration=item=>Boolean(registrationConvocationAffiliation(item));
const isRegistrationCampaign=item=>isProfessional(item)&&item.activity.cycle==='2026'&&
 item.publishAt<registrationLockAt&&!isScopedRegistration(item);
const registrationDueAt=item=>isRegistrationCampaign(item)?registrationLockAt:obligationDueAt(item);
const activityOrder=(a,b)=>a.publishAt-b.publishAt||a.id.localeCompare(b.id);
function restoredActivity(item,serverNow){
 if(typeof item?.id!=='string'||!item.id||item.id.length>120||
  !Number.isSafeInteger(item.publishAt)||item.publishAt<0||item.publishAt>serverNow)return null;
 try{
  return {id:item.id,publishAt:item.publishAt,dueAt:obligationDueAt(item),activity:validateObligation(item.activity),
   ...registrationConvocationScope(registrationConvocationAffiliation(item)),completed:item.completed===true};
 }catch{return null;}
}

/** One controller per authenticated session. Responses, never the device clock, advance age. */
export function mountCommunicationObligationBanner({client,uid,isCurrent=()=>true,onOpenActivity,root=document.body}={}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let disposed=false,items=[],completed=[],activeId=null,serverNow=null,error='',inFlight=null,position=null,drag=null,blocking=false,interacting=0,completionPending=false;
 let confirmedAt=win.performance.now(),refreshTimer;
 let omittedCursor=0,verificationCursor=0;
 const cacheKey='sahmt:activity-obligations:v1:'+uid;
 const legacyCacheKey='sahmt:professional-obligation:2026:'+uid;
 const inertBefore=new Map(),modals=[],listeners=[];
 const node=doc.createElement('section');node.className='communication-obligation';node.dataset.obligationBanner='';node.setAttribute('aria-label','Atividades obrigatórias');node.setAttribute('popover','manual');
 node.innerHTML='<div class="communication-obligation__move" role="group" tabindex="0" aria-label="Mover aviso com as setas do teclado">⋮⋮ ATIVIDADE OBRIGATÓRIA</div><div class="communication-obligation__content"><p role="status" aria-live="polite" data-status></p><ul data-activity-list aria-label="Lista de atividades"></ul></div>';
 const find=selector=>node.querySelector(selector),list=find('[data-activity-list]'),handle=find('.communication-obligation__move');
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 const alive=()=>{if(disposed)return false;if(!uid||!isCurrent()){cleanup();return false;}return true;};
 const registrationNow=()=>serverNow===null?0:serverNow+Math.floor(win.performance.now()-confirmedAt);
 const mandatoryRegistration=()=>registrationNow()>=registrationLockAt?items.find(isRegistrationCampaign):null;
 const stage=()=>items.length&&serverNow!==null?Math.max(...items.map(item=>{
  if(!isRegistrationCampaign(item))return obligationStage(item.publishAt,registrationNow(),item.dueAt);
  if(registrationNow()>=registrationLockAt)return 5;
  return Math.min(4,obligationStage(item.publishAt,serverNow,registrationLockAt));
 })):0;
 function restoreActivities(){
  try{
   const saved=JSON.parse(win.localStorage.getItem(cacheKey)||win.localStorage.getItem(legacyCacheKey));
   if(!isCurrent()||!Number.isSafeInteger(saved?.serverNow)||saved.serverNow<0||!Array.isArray(saved.items))return;
   const restored=saved.items.map(item=>restoredActivity(item,saved.serverNow)).filter(Boolean).sort(activityOrder);
   items=restored.filter(item=>!item.completed);
   completed=restored.filter(item=>item.completed);
   if(items.length)confirmedClock(saved.serverNow);
  }catch{/* Storage can be unavailable on this device. */}
 }
 function persistActivities(){
  try{
   const confirmedNow=registrationNow();
   const rows=[...items,...completed].map(item=>restoredActivity(item,confirmedNow)).filter(Boolean);
   if(items.length)win.localStorage.setItem(cacheKey,JSON.stringify({items:rows,serverNow:confirmedNow}));
   else win.localStorage.removeItem(cacheKey);
   win.localStorage.removeItem(legacyCacheKey);
  }catch{/* The live inbox remains authoritative. */}
 }
 function scheduleRefresh(){
  win.clearTimeout(refreshTimer);
  const legacy=items.some(isRegistrationCampaign);
  const deadlines=items.filter(item=>!isRegistrationCampaign(item))
   .map(item=>registrationDueAt(item)-registrationNow()).filter(value=>value>0);
  if(!items.length&&!error)return;
  const remaining=Math.min(...deadlines,60_000,...(legacy&&registrationLockAt>registrationNow()?[registrationLockAt-registrationNow()]:[]));
  refreshTimer=win.setTimeout(()=>{
   if(!alive())return;
   persistActivities();
   render();
   if(doc.visibilityState!=='hidden'&&win.navigator.onLine!==false&&!inFlight)void refresh();
   else scheduleRefresh();
  },remaining);
 }
 function restoreInert(){for(const [el,previous]of inertBefore)el.inert=previous;inertBefore.clear();}
 function applyBlocking(){
  restoreInert();if(!blocking||!node.isConnected)return;
  // Inert only sibling branches, preserving the host modal and the banner itself.
  for(let branch=node;branch&&branch!==doc.body;branch=branch.parentElement){for(const sibling of branch.parentElement?.children||[]){if(sibling!==branch&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){inertBefore.set(sibling,sibling.inert);sibling.inert=true;}}}
  if(!node.contains(doc.activeElement))find('[data-open]:enabled')?.focus({preventScroll:true});
 }
 function bound(){
  if(!node.isConnected||blocking)return;
  const viewport=win.visualViewport,w=viewport?.width||win.innerWidth,h=viewport?.height||win.innerHeight,ox=viewport?.offsetLeft||0,oy=viewport?.offsetTop||0;
  const rect=node.getBoundingClientRect();
  const x=position?.x??w-rect.width-12,y=position?.y??h-rect.height-12;
  position={x:Math.max(ox,Math.min(x,ox+w-rect.width)),y:Math.max(oy,Math.min(y,oy+h-rect.height))};
  node.style.left=position.x+'px';node.style.top=position.y+'px';
 }
 function host(){
  if(!alive()||!node.isConnected)return;
  if(isAppUpdateRequired(doc)){
   blocking=false;
   restoreInert();
   if(typeof node.hidePopover==='function'&&node.matches(':popover-open'))node.hidePopover();
   node.hidden=true;
   return;
  }
  const open=[...doc.querySelectorAll('dialog:modal')].filter(el=>el!==node);
  for(let i=modals.length-1;i>=0;i--)if(!open.includes(modals[i]))modals.splice(i,1);
  for(const modal of open)if(!modals.includes(modal))modals.push(modal);
  const target=modals.at(-1)||root;
  if(node.parentElement!==target){restoreInert();node.remove();target.append(node);}
  const required=mandatoryRegistration();
  const editingProfessional=target.closest('dialog:modal[data-panel="professional"]')&&
    (required||items.some(item=>item.id===activeId&&isProfessional(item)));
  const editingEpidemiological=target.closest('dialog:modal[data-panel="epidemiological"]')&&
    items.some(item=>item.id===activeId&&item.activity?.kind==='SURVEY'&&item.activity.id==='epidemiological');
  const editingRegistration=Boolean(editingProfessional||editingEpidemiological);
  const updatingAccess=target.matches('dialog.ecosystem-access-update');
  const active=items.some(item=>item.id===activeId);
  blocking=!updatingAccess&&Boolean(required?!editingRegistration:stage()===5&&!active&&!interacting);
  node.dataset.blocking=String(blocking);
  node.dataset.active=String(!blocking&&(active||interacting>0));
  handle.tabIndex=blocking?-1:0;
  if(blocking){node.style.left='0px';node.style.top='0px';}
  node.hidden=editingRegistration||updatingAccess;
  if(node.hidden){
   if(typeof node.hidePopover==='function'&&node.matches(':popover-open'))node.hidePopover();
   restoreInert();
   return;
  }
  // Popover enters the top layer after its containing modal and remains non-modal itself.
  if(typeof node.showPopover==='function'&&!node.matches(':popover-open'))try{node.showPopover();}catch{/* Older engines retain the positioned fallback. */}
  applyBlocking();bound();
 }
 function render(){
  if(!alive())return;
  if(!items.length){blocking=false;restoreInert();node.remove();return;}
  if(!node.isConnected)root.append(node);
  const required=mandatoryRegistration();
  const focusedId=list.contains(doc.activeElement)?doc.activeElement.dataset.open:null;
  const rows=[...items,...completed].sort(activityOrder);
  list.replaceChildren(...rows.map(item=>{
   const row=doc.createElement('li'),button=doc.createElement('button');
   const activity=item.activity, status=item.completed?'Concluída':'Pendente';
   button.type='button';
   button.dataset.open=item.id;
   button.dataset.state=item.completed?'completed':'pending';
   button.disabled=item.completed||interacting>0||Boolean(required&&required.id!==item.id);
   button.textContent=activity.title+' · '+status;
   row.append(button);
   if(item.completed)return row;
   const path=doc.createElement('p'),deadline=doc.createElement('p');
   path.dataset.path='';
   path.textContent=item.message?.match(/^Caminho no app: (Home › [^\r\n]+)$/m)?.[1]||activityBreadcrumb(activity);
   deadline.dataset.deadline='';
   deadline.textContent='Prazo: '+new Date(registrationDueAt(item)).toLocaleString('pt-BR',{
    timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'
   })+'.';
   row.append(path,deadline);
   if(activity.kind==='TRAINING'){
    const criterion=doc.createElement('p');
    criterion.dataset.criterion='';
    criterion.textContent='Nota mínima: '+activity.minimumScore+' de '+activity.maxScore+'.';
    row.append(criterion);
   }
   if(item.unavailable){
    const unavailable=doc.createElement('p');
    unavailable.textContent='Atividade indisponível. Procure o administrador.';
    row.append(unavailable);
   }
   if(item.id===focusedId&&!button.disabled)queueMicrotask(()=>{if(button.isConnected&&!node.hidden)button.focus({preventScroll:true});});
   return row;
  }));
  find('[data-status]').textContent=error||(required?'Preencha e salve o Cadastro Profissional para liberar o acesso ao aplicativo.':'');
  node.dataset.stage=String(stage());
  host();
 }
 function confirmedClock(value){if(!Number.isSafeInteger(value)||value<0)throw Error('COMM_INVALID_SERVER_TIME');serverNow=value;confirmedAt=win.performance.now();}
 async function refresh(){
  if(!alive())return;if(inFlight)return inFlight;
  const run=async()=>{
   try{
    const pending=await client.request('PENDING_ACTIVITIES',{});if(!alive())return;
    confirmedClock(pending.serverNow);
    if(!Array.isArray(pending.items))throw Error('COMM_INVALID_PENDING');
    const live=new Map(pending.items.filter(item=>item?.activity&&typeof item.id==='string'&&Number.isSafeInteger(item.publishAt)&&item.publishAt>=0&&!['COMPLETED','CANCELLED'].includes(item.status)).map(item=>[item.id,item]));
    const known=new Map(items.map(item=>[item.id,item]));
    for(const [id,item] of live)known.set(id,item);
    completed=completed.filter(item=>!live.has(item.id));
    items=[...known.values()].sort(activityOrder);
    error='';persistActivities();render();
    // Check omitted rows individually. An empty list is not a completion receipt.
    const omitted=items.filter(item=>!live.has(item.id));
    const start=omitted.length?omittedCursor%omitted.length:0;
    const missing=[...omitted.slice(start),...omitted.slice(0,start)].slice(0,4);
    omittedCursor=start+missing.length;
    const listed=[...live.values()].sort(activityOrder);
    const selected=mandatoryRegistration()||items.find(item=>item.id===activeId)||items.find(isRegistrationCampaign)||
     (listed.length?listed[verificationCursor++%listed.length]:null);
    if(selected&&!missing.includes(selected))missing.push(selected);
    for(const item of missing){
     try{
      const receipt=await client.request('VERIFY_ACTIVITY',{id:item.id},{activityKind:item.activity.kind});
      if(!alive())return;
      confirmedClock(receipt.serverNow);
      if(receipt.completed===true||receipt.reason==='ACTIVITY_CANCELLED'){
       items=items.filter(value=>value.id!==item.id);
       if(receipt.completed===true&&item.activity.kind==='TRAINING')completed.push({...item,completed:true});
       if(!items.length)completed=[];
       persistActivities();
      }else item.unavailable=Boolean(receipt.unavailable);
     }catch{if(alive())error='Não foi possível verificar a conclusão agora.';}
    }
   }catch{if(alive())error='Não foi possível verificar a conclusão agora.';}
  };
  inFlight=run();
  try{await inFlight;}finally{
   inFlight=null;
   if(alive()){
    render();scheduleRefresh();
    if(completionPending){completionPending=false;void refresh();}
   }
  }
 }
 async function openActivity(id){
  if(!alive()||interacting||isAppUpdateRequired(doc))return;
  const item=items.find(value=>value.id===id),required=mandatoryRegistration();
  if(!item||required&&required.id!==id)return;
  error='';interacting++;position=null;render();
  try{await onOpenActivity(item);}
  catch{if(alive())error='Não foi possível abrir a atividade. Tente novamente.';}
  finally{interacting--;if(alive())render();}
 }
 listen(list,'click',event=>{
  const button=event.target.closest('[data-open]:enabled');
  if(button)void openActivity(button.dataset.open);
 });
 listen(doc,APP_UPDATE_LOCK_EVENT,host);
 listen(handle,'keydown',event=>{if(blocking||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?40:10,rect=node.getBoundingClientRect();position={x:rect.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:rect.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};bound();});
 listen(handle,'pointerdown',event=>{if(blocking||event.button>0)return;event.preventDefault();const rect=node.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};try{handle.setPointerCapture(event.pointerId);}catch{/* Synthetic/older pointer implementations. */}});
 listen(handle,'pointermove',event=>{if(drag?.id!==event.pointerId)return;position={x:drag.left+event.clientX-drag.x,y:drag.top+event.clientY-drag.y};bound();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(handle,type,()=>{drag=null;});
 const gate=event=>{if(blocking&&!isAppUpdateRequired(doc)&&!node.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}};
 listen(doc,'click',gate,true);listen(doc,'submit',gate,true);
 listen(win,'resize',bound);if(win.visualViewport){listen(win.visualViewport,'resize',bound);listen(win.visualViewport,'scroll',bound);}
 for(const type of ['pageshow','online','focus'])listen(win,type,()=>void refresh());
 if(win.navigator.serviceWorker)listen(win.navigator.serviceWorker,'message',event=>{
  if(event.data?.source==='SAHMT_FF'&&event.data.type==='NEW_COMMUNICATION'&&event.data.communicationId?.startsWith('activity-'))void refresh();
 });
 for(const type of ['communication:activity-completed','html-training-score-updated'])listen(win,type,()=>{
  if(inFlight)completionPending=true;
  else void refresh();
 });
 listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='visible')void refresh();});
 const observer=new MutationObserver(records=>{if(!alive())return;for(const record of records){if(record.type==='attributes'&&record.target.matches('dialog')){const index=modals.indexOf(record.target);if(index>=0)modals.splice(index,1);if(record.target.matches(':modal'))modals.push(record.target);}}const relevant=records.some(record=>record.type==='attributes'||[...record.addedNodes,...record.removedNodes].some(el=>el!==node&&!node.contains(el)));if(relevant){if(node.isConnected)host();else if(items.length||error)render();}});
 observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 function cleanup(){if(disposed)return;disposed=true;win.clearTimeout(refreshTimer);observer.disconnect();for(const remove of listeners)remove();restoreInert();node.remove();items=[];completed=[];serverNow=null;activeId=null;position=drag=null;blocking=false;}
 function setActivityActive(idOrNull){
  if(!alive()||activeId===idOrNull)return;
  activeId=idOrNull||null;
  if(activeId)position=null;
  render();
 }
 if(uid&&isCurrent()){restoreActivities();render();scheduleRefresh();void refresh();}else cleanup();
 return {cleanup,refresh,setActivityActive,hasRegistrationConvocation:(id,kind)=>alive()&&
  items.some(item=>item.id===id&&item.activity?.id===kind&&isScopedRegistration(item))};
}
