export const PENDING_SYNC_MESSAGE='Atenção! Você tem registros pendentes de envio, Não feche seu app! Avisaremos quando tudo estiver sincronizado. Obrigado';
export const COMPLETED_SYNC_MESSAGE='Tudo certo! Obrigado pela sua paciência';

/** Local status only. A real commit event is required before a success notice. */
export function createSyncNoticeState(onChange=()=>{}){
 let uid='',hadPending=false,proof=false,state='hidden';
 const paint=next=>{if(state!==next){state=next;onChange({state,message:state==='pending'?PENDING_SYNC_MESSAGE:state==='complete'?COMPLETED_SYNC_MESSAGE:''});}};
 const select=next=>{if(uid!==next){uid=next||'';hadPending=false;proof=false;paint('hidden');}};
 return {
  pending(next){select(next);if(!uid)return;hadPending=true;proof=false;paint('pending');},
  confirmed(next){if(next&&next===uid&&hadPending)proof=true;},
  discarded(next){if(next===uid)proof=false;},
  update({uid:next,pendingCount,unavailable=false}){select(next);if(!uid)return paint('hidden');if(unavailable){if(hadPending)paint('pending');return;}
   if(pendingCount>0){hadPending=true;proof=false;paint('pending');}
   else if(hadPending&&proof){hadPending=false;proof=false;paint('complete');}
   else if(state==='pending'){hadPending=false;proof=false;paint('hidden');}
  },
  reset(next=''){select('');select(next);paint('hidden');},
  dismiss(){if(state==='complete')paint('hidden');},
  snapshot:()=>({uid,state,hadPending})
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
