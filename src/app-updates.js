import {repairAppFiles} from './app-repair.js';

/** Observe installed releases without activating them or reloading active pages. */
export async function watchAppUpdates({base,serviceWorker=globalThis.navigator?.serviceWorker,appWindow=globalThis.window,document=globalThis.document,isOnline=()=>globalThis.navigator?.onLine!==false,onAvailable=()=>{},onDismiss=()=>{},now=Date.now,intervalMs=300000}={}) {
  if(!serviceWorker||!appWindow||!document)return null;
  const registration=await serviceWorker.register(base+'service-worker.js',{scope:base,updateViaCache:'none'});
  let stopped=false,dismissed=false,announced=null,checking=false,lastCheck=-Infinity;
  const watched=new Map();
  const offer=worker=>{if(!stopped&&!dismissed&&serviceWorker.controller&&worker&&worker!==serviceWorker.controller&&worker!==announced){announced=worker;onAvailable({registration,worker});}};
  const observe=worker=>{
    if(!worker||watched.has(worker))return;
    const changed=()=>{if(worker.state==='installed')offer(registration.waiting||worker);};
    watched.set(worker,changed);worker.addEventListener('statechange',changed);changed();
  };
  const inspect=()=>{if(stopped)return;if(registration.waiting)offer(registration.waiting);observe(registration.installing);};
  async function check({force=false}={}) {
    if(stopped)return false;inspect();
    if(!isOnline()||checking||!force&&now()-lastCheck<30000)return false;
    checking=true;lastCheck=now();
    try{await registration.update();inspect();return true;}catch{return false;}finally{checking=false;}
  }
  const resume=()=>{if(stopped)return;dismissed=false;announced=null;inspect();void check();};
  const visibility=()=>{if(document.visibilityState==='visible')resume();};
  const online=()=>{void check({force:true});};
  registration.addEventListener('updatefound',inspect);
  appWindow.addEventListener('pageshow',resume);appWindow.addEventListener('online',online);
  document.addEventListener('visibilitychange',visibility);
  const timer=appWindow.setInterval(()=>{if(document.visibilityState!=='hidden')void check();},intervalMs);
  inspect();void check({force:true});
  return {check,dismiss(){dismissed=true;onDismiss();},stop(){stopped=true;appWindow.clearInterval(timer);registration.removeEventListener('updatefound',inspect);appWindow.removeEventListener('pageshow',resume);appWindow.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility);for(const [worker,listener] of watched)worker.removeEventListener('statechange',listener);watched.clear();}};
}

/** A nonmodal update notice remains usable above app dialogs on mobile. */
export async function installAppUpdatePrompt({base,target,document=globalThis.document,appWindow=globalThis.window,serviceWorker=globalThis.navigator?.serviceWorker,repair=repairAppFiles,...options}={}) {
  if(!document?.body||!serviceWorker||document.getElementById('sahmt-app-update-prompt'))return null;
  const prompt=document.createElement('aside');prompt.id='sahmt-app-update-prompt';prompt.className='app-update-prompt';prompt.hidden=true;prompt.setAttribute('role','status');prompt.setAttribute('aria-live','polite');
  prompt.innerHTML='<strong>Nova versão disponível</strong><p data-app-update-message>Uma atualização do SAHMT está pronta. Se estiver preenchendo algo, conclua antes de atualizar.</p><div class="app-update-actions"><button type="button" data-app-update>Atualizar agora</button><button type="button" data-app-update-later>Depois</button></div>';
  const supportsPopover=typeof prompt.showPopover==='function';if(supportsPopover)prompt.setAttribute('popover','manual');
  let visible=false,lastDialog=null,watcher;
  const hide=()=>{visible=false;if(supportsPopover)try{prompt.hidePopover();}catch{}prompt.hidden=true;};
  const place=()=>{
    if(!visible)return;
    const dialog=document.activeElement?.closest?.('dialog[open]')||[...document.querySelectorAll('dialog[open]')].at(-1)||null;
    const host=dialog||document.body;
    const moved=prompt.parentNode!==host;if(moved)host.append(prompt);
    if(supportsPopover&&(moved||dialog!==lastDialog||!prompt.matches(':popover-open'))){try{prompt.hidePopover();}catch{}try{prompt.showPopover();}catch{}}
    lastDialog=dialog;
  };
  const show=()=>{visible=true;prompt.hidden=false;place();};
  const click=event=>{
    if(event.target.closest('[data-app-update-later]')){watcher?.dismiss();return;}
    if(event.target.closest('[data-app-update]')){
      const accepted=repair({target,hash:appWindow.location.hash});
      if(!accepted)prompt.querySelector('[data-app-update-message]').textContent='Conecte-se à internet para atualizar o app.';
    }
  };
  prompt.addEventListener('click',click);document.body.append(prompt);
  const Observer=appWindow.MutationObserver;
  const observer=Observer?new Observer(place):null;observer?.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  try{watcher=await watchAppUpdates({base,serviceWorker,document,appWindow,...options,onAvailable:show,onDismiss:hide});}
  catch(error){observer?.disconnect();prompt.remove();throw error;}
  return {check:watcher?.check,stop(){watcher?.stop();observer?.disconnect();prompt.removeEventListener('click',click);hide();prompt.remove();}};
}
