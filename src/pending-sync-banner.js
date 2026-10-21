export const PENDING_SYNC_MESSAGE='Atenção! Você tem registros pendentes de envio, Não feche seu app! Avisaremos quando tudo estiver sincronizado. Obrigado';
export const COMPLETED_SYNC_MESSAGE='Tudo certo! Obrigado pela sua paciência';

/** Local status only. A real commit event is required before a success notice. */
export function createSyncNoticeState(onChange=()=>{},{pendingGraceMs=5000,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}={}){
 let uid='',hadPending=false,state='hidden',pendingTimer=null,unsettledCount=0;
 const pendingIds=new Set(),confirmedIds=new Set();
 const paint=next=>{if(state!==next){state=next;onChange({state,message:state==='pending'?PENDING_SYNC_MESSAGE:state==='complete'?COMPLETED_SYNC_MESSAGE:''});}};
 const clearPendingTimer=()=>{if(pendingTimer!==null){clearTimeoutFn(pendingTimer);pendingTimer=null;}};
 const showPendingAfterGrace=()=>{if(pendingTimer!==null)return;if(pendingGraceMs<=0){paint('pending');return;}pendingTimer=setTimeoutFn(()=>{pendingTimer=null;if(hadPending&&(unsettledCount>0||pendingIds.size>0))paint('pending');},pendingGraceMs);};
 const select=next=>{if(uid!==next){uid=next||'';hadPending=false;unsettledCount=0;pendingIds.clear();confirmedIds.clear();clearPendingTimer();paint('hidden');}};
 return {
  pending(next,requestId=''){select(next);if(!uid)return;if(state==='complete')paint('hidden');hadPending=true;unsettledCount=Math.max(unsettledCount,1);if(requestId){pendingIds.add(requestId);confirmedIds.clear();}showPendingAfterGrace();},
  confirmed(next,requestId=''){if(next&&next===uid&&requestId&&pendingIds.has(requestId)){pendingIds.delete(requestId);confirmedIds.add(requestId);}},
  discarded(next,requestId=''){if(next===uid){if(requestId)pendingIds.delete(requestId);else pendingIds.clear();confirmedIds.clear();if(!pendingIds.size){unsettledCount=0;hadPending=false;clearPendingTimer();paint('hidden');}}},
  update({uid:next,pendingCount,pendingIds:nextPendingIds,unavailable=false}){select(next);if(!uid)return paint('hidden');if(Array.isArray(nextPendingIds)){pendingIds.clear();for(const id of nextPendingIds)if(typeof id==='string'&&id)pendingIds.add(id);}if(unavailable){if(hadPending)paint('pending');return;}
   unsettledCount=Math.max(0,Number(pendingCount)||0);
   if(unsettledCount>0||pendingIds.size>0){hadPending=true;showPendingAfterGrace();}
   else if(hadPending&&confirmedIds.size>0){clearPendingTimer();hadPending=false;unsettledCount=0;pendingIds.clear();confirmedIds.clear();paint('complete');}
   else if(hadPending){clearPendingTimer();hadPending=false;unsettledCount=0;pendingIds.clear();confirmedIds.clear();paint('hidden');}
   else if(state==='pending')paint('hidden');
  },
  reset(next=''){select('');select(next);paint('hidden');},
  dismiss(){if(state==='complete')paint('hidden');},
  snapshot:()=>({uid,state,hadPending,pendingIds:[...pendingIds],confirmedIds:[...confirmedIds]})
 };
}

export function createPendingSyncBanner({documentSource=globalThis.document,onOpen=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let element=null,timer=null,observer=null;
 const elevate=(hint=null,force=false)=>{
  if(!element)return;
  const host=hint?.open?hint:[...documentSource.querySelectorAll('dialog[open]')].at(-1)||documentSource.body;
  const moved=element.parentElement!==host;
  if(!moved&&!force)return;
  try{if(element.matches?.(':popover-open'))element.hidePopover();}catch{}
  if(moved)host.append(element);
  if(typeof element.showPopover==='function'){try{element.showPopover();}catch{}}
 };
 const observe=()=>{
  if(observer||typeof globalThis.MutationObserver!=='function')return;
  observer=new MutationObserver(records=>{
   if(!element)return;const opened=records.filter(row=>row.type==='attributes'&&row.attributeName==='open'&&row.target.open).at(-1)?.target;
   if(opened||!element.isConnected||records.some(row=>row.type==='attributes'&&row.attributeName==='open'))elevate(opened);
  });observer.observe(documentSource.body,{attributes:true,attributeFilter:['open'],childList:true,subtree:true});
 };
 const controller=createSyncNoticeState(view=>{
  clearTimer(timer);timer=null;
  if(view.state==='hidden'){observer?.disconnect();observer=null;if(element){try{if(element.matches?.(':popover-open'))element.hidePopover();}catch{}element.remove();element=null;}return;}
  if(!element){element=documentSource.createElement('aside');element.id='pending-sync-banner';element.setAttribute('role','status');element.setAttribute('aria-live','polite');element.setAttribute('aria-atomic','true');element.setAttribute('popover','manual');
   const message=documentSource.createElement('p');message.dataset.syncNoticeText='';element.append(message);
   const button=documentSource.createElement('button');button.type='button';button.textContent='Ver pendências';button.dataset.syncNoticeOpen='';button.addEventListener('click',onOpen);element.append(button);documentSource.body.append(element);}
  element.className='pending-sync-banner pending-sync-banner--'+view.state;element.querySelector('[data-sync-notice-text]').textContent=view.message;
  element.querySelector('[data-sync-notice-open]').hidden=view.state!=='pending';
  elevate(null,true);observe();
  if(view.state==='complete')timer=setTimer(()=>controller.dismiss(),10000);
 });
 return controller;
}
