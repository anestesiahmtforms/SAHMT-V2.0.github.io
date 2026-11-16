import {obligationStage,OBLIGATION_DAY} from '../communication/obligations.js';
import './communication-obligation-banner.css';

/** One controller per authenticated session. Responses, never the device clock, advance age. */
export function mountCommunicationObligationBanner({client,uid,isCurrent=()=>true,onOpenActivity,onRecover,onSignOut,root=document.body}={}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let disposed=false,items=[],selectedId=null,activeId=null,serverNow=null,error='',inFlight=null,position=null,drag=null,blocking=false,interacting=0;
 const inertBefore=new Map(),modals=[],listeners=[];
 const node=doc.createElement('section');node.className='communication-obligation';node.dataset.obligationBanner='';node.setAttribute('aria-label','Atividades obrigatórias');node.setAttribute('popover','manual');
 node.innerHTML='<button type="button" class="communication-obligation__move" aria-label="Mover aviso com as setas do teclado">⋮⋮ ATIVIDADE OBRIGATÓRIA</button><div class="communication-obligation__content"><strong data-count></strong><label>Atividade pendente<select aria-label="Atividade pendente"></select></label><p data-message></p><p data-criterion></p><p data-deadline></p><p role="status" aria-live="polite" data-status></p><div class="communication-obligation__actions"><button type="button" data-open>Abrir atividade</button><button type="button" data-verify>Verificar conclusão</button><button type="button" data-recover>Recuperar acesso</button><button type="button" data-signout>Sair da conta</button></div></div>';
 const find=selector=>node.querySelector(selector),select=find('select'),handle=find('.communication-obligation__move');
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 const alive=()=>{if(disposed)return false;if(!uid||!isCurrent()){cleanup();return false;}return true;};
 const current=()=>items.find(item=>item.id===selectedId)||items[0];
 const stage=()=>items.length&&serverNow!==null?Math.max(...items.map(item=>obligationStage(item.publishAt,serverNow))):0;
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
  const options=items.map(value=>{const option=doc.createElement('option');option.value=value.id;option.textContent=value.title||value.activity?.title||'Atividade';return option;});
  select.replaceChildren(...options);select.value=selectedId||'';select.disabled=!item;
  find('[data-count]').textContent=items.length?`${items.length} atividade${items.length===1?'':'s'} pendente${items.length===1?'':'s'}`:'Verificação de atividades';
  find('[data-message]').textContent=item?.message||'';
  const activity=item?.activity;
  find('[data-criterion]').textContent=activity?.kind==='TRAINING'?`Concluir ${activity.title||'o treinamento'} (versão ${activity.version}) com nota mínima ${activity.minimumScore} de ${activity.maxScore}.`:activity?`Enviar as respostas de ${activity.title||'enquete'} no ciclo ${activity.cycle}.`:'';
  find('[data-deadline]').textContent=item?`Prazo: ${new Date(item.publishAt+5*OBLIGATION_DAY).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília). Após cinco dias, conclua uma atividade para continuar.`:'';
  find('[data-status]').textContent=error||(item?.unavailable?(item.reason||'Atividade indisponível. Solicite ao administrador o cancelamento da convocação.'):activeId?'Atividade em andamento. Verifique a conclusão após enviar.':'A conclusão será confirmada pelo serviço de origem.');
  find('[data-open]').disabled=!item;find('[data-verify]').disabled=Boolean(inFlight);
  const active=items.some(value=>value.id===activeId);
  blocking=stage()===5&&!active&&!interacting;node.dataset.stage=String(stage());node.dataset.blocking=String(blocking);node.dataset.active=String(active||interacting>0);
  if(blocking){node.style.left='0px';node.style.top='0px';}
  host();
 }
 function confirmedClock(value){if(!Number.isSafeInteger(value)||value<0)throw Error('COMM_INVALID_SERVER_TIME');serverNow=value;}
 async function refresh(){
  if(!alive())return;if(inFlight)return inFlight;
  const run=async()=>{
   try{
    const pending=await client.request('PENDING_ACTIVITIES',{});if(!alive())return;
    confirmedClock(pending.serverNow);
    if(!Array.isArray(pending.items))throw Error('COMM_INVALID_PENDING');
    items=pending.items.filter(item=>typeof item?.id==='string'&&Number.isSafeInteger(item.publishAt)&&item.publishAt>=0&&!['COMPLETED','CANCELLED'].includes(item.status)).sort((a,b)=>a.publishAt-b.publishAt||a.id.localeCompare(b.id));
    if(!items.some(item=>item.id===selectedId))selectedId=items[0]?.id||null;
    error='';render();
    // Never verify a whole inbox on resume: one selected/opened obligation per refresh.
    const selected=items.find(item=>item.id===activeId)||current();
    if(selected){const receipt=await client.request('VERIFY_ACTIVITY',{id:selected.id});if(!alive())return;confirmedClock(receipt.serverNow);
     if(receipt.completed)items=items.filter(item=>item.id!==selected.id);
     else{selected.unavailable=Boolean(receipt.unavailable);selected.reason=receipt.reason||'';}
    }
   }catch(cause){if(alive())error='Não foi possível verificar a conclusão. Confira a conexão ou recupere o acesso e tente novamente.';}
  };
  inFlight=run();try{await inFlight;}finally{inFlight=null;if(alive())render();}
 }
 async function action(callback){if(!alive())return;interacting++;position=null;render();try{await callback?.();}catch{if(alive())error='Não foi possível abrir ou recuperar o acesso. Tente novamente ou saia da conta.';}finally{interacting--;if(alive())render();}}
 listen(select,'change',()=>{selectedId=select.value;render();});
 listen(find('[data-open]'),'click',()=>{const item=current();if(item)void action(()=>onOpenActivity?.(item));});
 listen(find('[data-verify]'),'click',()=>void refresh());
 listen(find('[data-recover]'),'click',()=>void action(async()=>{await onRecover?.();if(alive())await refresh();}));
 listen(find('[data-signout]'),'click',()=>void action(()=>onSignOut?.()));
 listen(handle,'keydown',event=>{if(blocking||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?40:10,rect=node.getBoundingClientRect();position={x:rect.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:rect.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};bound();});
 listen(handle,'pointerdown',event=>{if(blocking||event.button>0)return;event.preventDefault();const rect=node.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};try{handle.setPointerCapture(event.pointerId);}catch{/* Synthetic/older pointer implementations. */}});
 listen(handle,'pointermove',event=>{if(drag?.id!==event.pointerId)return;position={x:drag.left+event.clientX-drag.x,y:drag.top+event.clientY-drag.y};bound();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(handle,type,()=>{drag=null;});
 const gate=event=>{if(blocking&&!node.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}};
 listen(doc,'click',gate,true);listen(doc,'submit',gate,true);
 listen(win,'resize',bound);if(win.visualViewport){listen(win.visualViewport,'resize',bound);listen(win.visualViewport,'scroll',bound);}
 for(const type of ['pageshow','online','communication:activity-completed'])listen(win,type,()=>void refresh());
 listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='visible')void refresh();});
 const observer=new MutationObserver(records=>{if(!alive())return;for(const record of records){if(record.type==='attributes'&&record.target.matches('dialog')){const index=modals.indexOf(record.target);if(index>=0)modals.splice(index,1);if(record.target.matches(':modal'))modals.push(record.target);}}const relevant=records.some(record=>record.type==='attributes'||[...record.addedNodes,...record.removedNodes].some(el=>el!==node&&!node.contains(el)));if(relevant){if(node.isConnected)host();else if(items.length||error)render();}});
 observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 function cleanup(){if(disposed)return;disposed=true;observer.disconnect();for(const remove of listeners)remove();restoreInert();node.remove();items=[];serverNow=null;activeId=selectedId=null;position=drag=null;blocking=false;}
 function setActivityActive(idOrNull){
  if(!alive()||activeId===idOrNull)return;
  activeId=idOrNull||null;
  if(activeId)position=null;
  render();
 }
 if(uid&&isCurrent())void refresh();else cleanup();
 return {cleanup,refresh,setActivityActive};
}
