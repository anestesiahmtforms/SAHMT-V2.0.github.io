import {obligationDueAt,obligationStage,registrationConvocationAffiliation} from '../communication/obligations.js';
import {activityBreadcrumb} from './communication-activity-selection.js';
import './communication-obligation-banner.css';

const registrationLockAt=Date.parse('2026-11-27T00:00:00-03:00');
const isProfessional=item=>item?.activity?.kind==='SURVEY'&&item.activity.id==='professional';
const isScopedRegistration=item=>Boolean(registrationConvocationAffiliation(item));
const isRegistrationCampaign=item=>isProfessional(item)&&item.activity.cycle==='2026'&&!isScopedRegistration(item);
const registrationDueAt=item=>isRegistrationCampaign(item)?registrationLockAt:obligationDueAt(item);

/** One controller per authenticated session. Responses, never the device clock, advance age. */
export function mountCommunicationObligationBanner({client,uid,isCurrent=()=>true,onOpenActivity,root=document.body}={}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let disposed=false,items=[],selectedId=null,activeId=null,serverNow=null,error='',inFlight=null,position=null,drag=null,blocking=false,interacting=0,completionPending=false;
 let confirmedAt=win.performance.now(),refreshTimer;
 const cacheKey='sahmt:professional-obligation:2026:'+uid;
 const inertBefore=new Map(),modals=[],listeners=[];
 const node=doc.createElement('section');node.className='communication-obligation';node.dataset.obligationBanner='';node.setAttribute('aria-label','Atividades obrigatórias');node.setAttribute('popover','manual');
 node.innerHTML='<div class="communication-obligation__move" role="group" tabindex="0" aria-label="Mover aviso com as setas do teclado">⋮⋮ ATIVIDADE OBRIGATÓRIA</div><div class="communication-obligation__content"><label class="communication-obligation__selection"><span>Atividade pendente</span><select aria-label="Atividade pendente"></select></label><p data-path></p><p data-criterion></p><p data-deadline></p><p role="status" aria-live="polite" data-status></p><button type="button" data-open>Abrir atividade</button></div>';
 const find=selector=>node.querySelector(selector),select=find('select'),handle=find('.communication-obligation__move');
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 const alive=()=>{if(disposed)return false;if(!uid||!isCurrent()){cleanup();return false;}return true;};
 const registrationNow=()=>serverNow===null?0:serverNow+Math.floor(win.performance.now()-confirmedAt);
 const mandatoryRegistration=()=>registrationNow()>=registrationLockAt?items.find(isRegistrationCampaign):null;
 const current=()=>mandatoryRegistration()||items.find(item=>item.id===selectedId)||items[0];
 const stage=()=>items.length&&serverNow!==null?Math.max(...items.map(item=>{
  if(!isRegistrationCampaign(item))return obligationStage(item.publishAt,isScopedRegistration(item)?registrationNow():serverNow,item.dueAt);
  if(registrationNow()>=registrationLockAt)return 5;
  return Math.min(4,obligationStage(item.publishAt,serverNow,registrationLockAt));
 })):0;
 function restoreRegistration(){
  try{
   const saved=JSON.parse(win.localStorage.getItem(cacheKey));
   if(!isCurrent()||!Number.isSafeInteger(saved?.serverNow)||saved.serverNow<0||!Array.isArray(saved.items))return;
   items=saved.items.filter(item=>isRegistrationCampaign(item)&&/^activity-[a-zA-Z0-9-]{1,100}$/.test(item.id)&&
    Number.isSafeInteger(item.publishAt)&&item.publishAt>=0&&item.publishAt<=saved.serverNow);
   if(items.length)confirmedClock(saved.serverNow);
  }catch{/* Storage can be unavailable on this device. */}
 }
 function persistRegistration(){
  try{
   const pending=items.filter(isRegistrationCampaign).map(({id,publishAt,activity})=>({id,publishAt,activity}));
   if(pending.length)win.localStorage.setItem(cacheKey,JSON.stringify({items:pending,serverNow:registrationNow()}));
   else win.localStorage.removeItem(cacheKey);
  }catch{/* The live inbox remains authoritative. */}
 }
 function scheduleRefresh(){
  win.clearTimeout(refreshTimer);
  const legacy=items.some(isRegistrationCampaign);
  const deadlines=items.filter(isScopedRegistration)
   .map(item=>registrationDueAt(item)-registrationNow()).filter(value=>value>0);
  if(!legacy&&!deadlines.length)return;
  const remaining=Math.min(...deadlines,60_000,...(legacy&&registrationLockAt>registrationNow()?[registrationLockAt-registrationNow()]:[]));
  refreshTimer=win.setTimeout(()=>{
   if(!alive())return;
   if(mandatoryRegistration())persistRegistration();
   render();
   if(legacy&&doc.visibilityState!=='hidden'&&win.navigator.onLine!==false&&!inFlight)void refresh();
   else scheduleRefresh();
  },remaining);
 }
 function restoreInert(){for(const [el,previous]of inertBefore)el.inert=previous;inertBefore.clear();}
 function applyBlocking(){
  restoreInert();if(!blocking||!node.isConnected)return;
  // Inert only sibling branches, preserving the host modal and the banner itself.
  for(let branch=node;branch&&branch!==doc.body;branch=branch.parentElement){for(const sibling of branch.parentElement?.children||[]){if(sibling!==branch&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){inertBefore.set(sibling,sibling.inert);sibling.inert=true;}}}
  if(!node.contains(doc.activeElement))find('[data-open]').focus({preventScroll:true});
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
  const open=[...doc.querySelectorAll('dialog:modal')].filter(el=>el!==node);
  for(let i=modals.length-1;i>=0;i--)if(!open.includes(modals[i]))modals.splice(i,1);
  for(const modal of open)if(!modals.includes(modal))modals.push(modal);
  const target=modals.at(-1)||root;
  if(node.parentElement!==target){restoreInert();node.remove();target.append(node);}
  const required=mandatoryRegistration();
  const editingProfessional=target.closest('dialog:modal[data-panel="professional"]')&&
    (required||items.some(item=>item.id===activeId&&isProfessional(item)));
  const editingEpidemiological=target.closest('dialog:modal[data-panel="epidemiological"]')&&
    items.some(item=>item.id===activeId&&isScopedRegistration(item)&&item.activity?.id==='epidemiological');
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
  // A failed inbox lookup is not evidence of an administrator-issued activity.
  // Keep an existing obligation visible across transient errors, but never create
  // a banner from an empty/unknown inbox response.
  if(!items.length){blocking=false;restoreInert();node.remove();return;}
  if(!node.isConnected)root.append(node);
  const item=current();selectedId=item?.id||null;
  const required=mandatoryRegistration();
  const options=(required?[required]:items).map(value=>{const option=doc.createElement('option');option.value=value.id;option.textContent=value.activity?.title||value.title||'Atividade';return option;});
  select.replaceChildren(...options);select.value=selectedId||'';select.disabled=!item||Boolean(required);
  const activity=item?.activity;
  const savedPath=item.message?.match(/^Caminho no app: (Home › [^\r\n]+)$/m)?.[1];
  find('[data-path]').textContent=savedPath||activityBreadcrumb(activity);
  find('[data-criterion]').textContent=activity?.kind==='TRAINING'?`Nota mínima: ${activity.minimumScore} de ${activity.maxScore}.`:'';
  const clock=new Date(registrationDueAt(item)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
  find('[data-deadline]').textContent=`Prazo: ${clock}.`;
  find('[data-status]').textContent=error||(item.unavailable?'Atividade indisponível. Procure o administrador.':
    required?'Preencha e salve o Cadastro Profissional para liberar o acesso ao aplicativo.':'');
  const button=find('[data-open]');
  button.textContent=isProfessional(item)?'Abrir Cadastro Profissional':'Abrir atividade';
  button.disabled=!item||interacting>0;
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
    items=pending.items.filter(item=>typeof item?.id==='string'&&Number.isSafeInteger(item.publishAt)&&item.publishAt>=0&&!['COMPLETED','CANCELLED'].includes(item.status)).sort((a,b)=>a.publishAt-b.publishAt||a.id.localeCompare(b.id));
    if(!items.some(item=>item.id===selectedId))selectedId=items[0]?.id||null;
    error='';persistRegistration();render();
    // Never verify a whole inbox on resume: one selected/opened obligation per refresh.
    const selected=mandatoryRegistration()||items.find(item=>item.id===activeId)||items.find(isRegistrationCampaign)||current();
    if(selected?.activity){const receipt=await client.request('VERIFY_ACTIVITY',{id:selected.id},{activityKind:selected.activity.kind});if(!alive())return;confirmedClock(receipt.serverNow);
     if(receipt.completed||receipt.reason==='ACTIVITY_CANCELLED'){items=items.filter(item=>item.id!==selected.id);persistRegistration();}
     else selected.unavailable=Boolean(receipt.unavailable);
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
 async function openActivity(){
  if(!alive()||interacting)return;
  const item=current();if(!item)return;
  error='';interacting++;position=null;render();
  try{await onOpenActivity(item);}
  catch{if(alive())error='Não foi possível abrir a atividade. Tente novamente.';}
  finally{interacting--;if(alive())render();}
 }
 listen(select,'change',()=>{selectedId=select.value;render();});
 listen(find('[data-open]'),'click',()=>void openActivity());
 listen(handle,'keydown',event=>{if(blocking||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?40:10,rect=node.getBoundingClientRect();position={x:rect.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:rect.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};bound();});
 listen(handle,'pointerdown',event=>{if(blocking||event.button>0)return;event.preventDefault();const rect=node.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};try{handle.setPointerCapture(event.pointerId);}catch{/* Synthetic/older pointer implementations. */}});
 listen(handle,'pointermove',event=>{if(drag?.id!==event.pointerId)return;position={x:drag.left+event.clientX-drag.x,y:drag.top+event.clientY-drag.y};bound();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(handle,type,()=>{drag=null;});
 const gate=event=>{if(blocking&&!node.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}};
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
 function cleanup(){if(disposed)return;disposed=true;win.clearTimeout(refreshTimer);observer.disconnect();for(const remove of listeners)remove();restoreInert();node.remove();items=[];serverNow=null;activeId=selectedId=null;position=drag=null;blocking=false;}
 function setActivityActive(idOrNull){
  if(!alive()||activeId===idOrNull)return;
  activeId=idOrNull||null;
  if(activeId)position=null;
  render();
 }
 if(uid&&isCurrent()){restoreRegistration();render();scheduleRefresh();void refresh();}else cleanup();
 return {cleanup,refresh,setActivityActive,hasRegistrationConvocation:(id,kind)=>alive()&&
  items.some(item=>item.id===id&&item.activity?.id===kind&&isScopedRegistration(item))};
}
