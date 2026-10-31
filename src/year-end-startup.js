import {canUseYearEndSchedule,confirmedYearEndRegistration} from './year-end-schedule.js';

// Temporary campaign for the current cycle. Completion stays in the existing
// server registration; dismissing the card only affects this app opening.
export const YEAR_END_STARTUP_ENABLED=true;
export function createYearEndStartup({enabled=YEAR_END_STARTUP_ENABLED,readStatus,onChange=()=>{}}={}) {
  let uid='',generation=0,status='inactive',reading=false;
  const dismissed=new Set();
  const controller={
    get status(){return status;},
    get visible(){return status==='pending'&&!dismissed.has(uid);},
    setSession(session) {
      const next=enabled&&canUseYearEndSchedule(session)?session.user.uid:'';
      if(next!==uid){uid=next;++generation;reading=false;status=uid?'checking':'inactive';onChange();}
      if(!uid||session.offline||session.validatingProfile||reading||status!=='checking')return;
      const ticket=generation;reading=true;
      const current=()=>ticket===generation&&uid===next;
      void Promise.resolve().then(()=>readStatus({uid:next,isCurrent:current})).then(({participation,own})=>{
        if(!current())return;
        status=participation?.canParticipate===true?(confirmedYearEndRegistration(own,{...participation,uid})?'complete':'pending'):'inactive';
        onChange();
      },()=>{if(current()){status='unavailable';onChange();}});
    },
    dismiss(){if(uid)dismissed.add(uid);onChange();},
    confirm(account,record,participation) {
      if(account!==uid||!confirmedYearEndRegistration(record,{...participation,uid}))return false;
      ++generation;status='complete';onChange();return true;
    }
  };
  return controller;
}

export function yearEndStartupMarkup(baseUrl) {
  const colors=['#16803d','#0876cf','#ef9e16','#ed597a','#8d54d8','#08a391'];
  const particles=Array.from({length:16},(_,i)=>{
    const angle=i*Math.PI/8,x=Math.round(Math.cos(angle)*116),y=Math.round(Math.sin(angle)*86);
    return `<i class="boot-particle" style="--x:${x}px;--y:${y}px;--d:${i%3*.02}s;--c:${colors[i%colors.length]}"></i>`;
  }).join('');
  return `<aside class="year-end-startup year-end-floating" aria-labelledby="year-end-startup-title"><div class="boot-card boot-card--year-end">
    <button type="button" class="year-end-startup-close" data-year-end-dismiss aria-label="Fechar banner">×</button>
    <img src="${baseUrl}assets/icon-192.png" width="76" height="76" alt="SAHMT"><strong>SAHMT</strong>
    <span class="boot-slogan year-end-startup-title" id="year-end-startup-title" role="heading" aria-level="1"><span class="year-end-startup-burst">ESCALA FINAL DE ANO</span></span>
    <span class="boot-particles" aria-hidden="true">${particles}</span>
    <button type="button" class="primary-button year-end-startup-action" data-year-end-open>ESCALA FINAL DE ANO</button>
  </div></aside>`;
}

// This surface lives outside the page root, so navigation never dismisses it.
// Reparent into the current dialog for browsers without Popover/top-layer support.
export function installYearEndFloatingBanner({controller,baseUrl,onOpen,canShow=()=>true,
  document=globalThis.document,appWindow=globalThis.window}={}) {
  const holder=document.createElement('div');holder.innerHTML=yearEndStartupMarkup(baseUrl);
  const banner=holder.firstElementChild,supportsPopover=typeof banner.showPopover==='function';
  if(supportsPopover)banner.setAttribute('popover','manual');
  banner.hidden=true;document.body.append(banner);let lastDialog=null,stopped=false;
  const hide=()=>{if(supportsPopover)try{banner.hidePopover();}catch{}banner.hidden=true;};
  const update=()=>{
    if(stopped)return;
    if(!controller.visible||!canShow()){hide();return;}
    const dialog=document.activeElement?.closest?.('dialog[open]')||[...document.querySelectorAll('dialog[open]')].at(-1)||null;
    const host=dialog||document.body,moved=banner.parentNode!==host;
    if(moved)host.append(banner);
    banner.hidden=false;
    if(supportsPopover&&(moved||dialog!==lastDialog||!banner.matches(':popover-open'))){
      try{banner.hidePopover();}catch{}try{banner.showPopover();}catch{}
    }
    lastDialog=dialog;
  };
  const click=event=>{
    if(event.target.closest('[data-year-end-dismiss]')){controller.dismiss();update();}
    if(event.target.closest('[data-year-end-open]')){onOpen();update();}
  };
  banner.addEventListener('click',click);
  const observer=appWindow.MutationObserver?new appWindow.MutationObserver(update):null;
  observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  return {update,stop(){stopped=true;observer?.disconnect();hide();banner.removeEventListener('click',click);banner.remove();}};
}
