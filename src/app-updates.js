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

export const APP_UPDATE_LOCK_EVENT='sahmt:app-update-lock-changed';

/** Keep the current version blocked until the update page takes over. */
export async function installAppUpdatePrompt({base,target,document=globalThis.document,appWindow=globalThis.window,serviceWorker=globalThis.navigator?.serviceWorker,repair=repairAppFiles,...options}={}) {
  if(!document?.body||!serviceWorker||document.getElementById('sahmt-app-update-prompt'))return null;
  const prompt=document.createElement('dialog');
  prompt.id='sahmt-app-update-prompt';
  prompt.className='app-update-prompt';
  prompt.dataset.appUpdateRequired='';
  prompt.setAttribute('aria-labelledby','sahmt-app-update-title');
  prompt.setAttribute('aria-describedby','sahmt-app-update-message');
  prompt.innerHTML='<strong id="sahmt-app-update-title">Nova versão disponível</strong><p id="sahmt-app-update-message" data-app-update-message role="status">Atualize o SAHMT para continuar.</p><button type="button" data-app-update autofocus>Atualizar agora</button>';
  const button=prompt.querySelector('[data-app-update]');
  const message=prompt.querySelector('[data-app-update-message]');
  let watcher,updating=false,lockedHash='',retryTimer;
  const signalLock=()=>document.dispatchEvent(new appWindow.Event(APP_UPDATE_LOCK_EVENT));
  const show=()=>{
    if(prompt.open)return;
    lockedHash=appWindow.location.hash;
    prompt.showModal();
    signalLock();
    button.focus();
  };
  const preventCancel=event=>event.preventDefault();
  const restoreRoute=()=>{
    if(prompt.open&&appWindow.location.hash!==lockedHash){
      appWindow.history.replaceState(appWindow.history.state,'',appWindow.location.pathname+appWindow.location.search+lockedHash);
    }
  };
  const retry=()=>{
    updating=false;
    button.disabled=false;
    message.textContent='Não foi possível iniciar a atualização. Confira a conexão e tente novamente.';
    button.focus();
  };
  const click=()=>{
    if(updating)return;
    const hash=/^#\/[a-z0-9/-]*$/i.test(lockedHash)&&lockedHash.length<=250?lockedHash:target==='FB'?'#/management':'#/home';
    updating=true;
    button.disabled=true;
    message.textContent='Abrindo a atualização do SAHMT…';
    try{
      if(!repair({target,hash}))throw Error('UPDATE_NOT_STARTED');
      retryTimer=appWindow.setTimeout(retry,4000);
    }catch{retry();}
  };
  button.addEventListener('click',click);
  prompt.addEventListener('cancel',preventCancel);
  appWindow.addEventListener('hashchange',restoreRoute,true);
  document.body.append(prompt);
  const Observer=appWindow.MutationObserver;
  const observer=Observer?new Observer(records=>{
    if(!prompt.open||!records.some(record=>record.target!==prompt&&record.target.matches?.('dialog:modal')))return;
    prompt.close();
    prompt.showModal();
    button.focus();
  }):null;
  observer?.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  function stop(){
    watcher?.stop();
    observer?.disconnect();
    appWindow.clearTimeout(retryTimer);
    appWindow.removeEventListener('hashchange',restoreRoute,true);
    button.removeEventListener('click',click);
    prompt.removeEventListener('cancel',preventCancel);
    const wasOpen=prompt.open;
    if(wasOpen)prompt.close();
    prompt.remove();
    if(wasOpen)signalLock();
  }
  try{watcher=await watchAppUpdates({base,serviceWorker,document,appWindow,...options,onAvailable:show});}
  catch(error){stop();throw error;}
  return {check:watcher?.check,stop};
}
