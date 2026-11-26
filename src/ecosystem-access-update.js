import {GOOGLE_AUTH_TARGETS} from './google-project-auth-core.js';
import {googleProjectAuthEnabled} from './google-project-auth-config.js';
import {withinDeadline} from './async-deadline.js';

export const ecosystemStations=Object.freeze([...GOOGLE_AUTH_TARGETS,'FF','FG','FH','FI','FJ','FK']);
const googleStations=[...GOOGLE_AUTH_TARGETS,'FF','FK'];
const operationalStations=['FG','FH','FI','FJ'];
const recoveryReleaseFloor=Date.parse('2026-11-26T11:03:17Z');
const statusLabel={ready:'verificado',excluded:'sem acesso para este perfil',disabled:'módulo desativado',pending:'pendente'};
const complete=statuses=>ecosystemStations.every(station=>['ready','excluded','disabled'].includes(statuses[station]));

export function ecosystemAccessStatuses(google, operational, primaryVerified) {
 const statuses=Object.fromEntries(googleStations.map(station=>{
  const status=google?.targets?.[station]?.status;
  return [station,status==='ready'||status==='excluded'?status:'pending'];
 }));
 statuses.FA=primaryVerified?'ready':'pending';
 for(const station of operationalStations)statuses[station]=operational[station]||'pending';
 return {statuses,complete:complete(statuses),needsGoogle:googleStations.some(station=>statuses[station]==='pending')};
}

async function checkFi(uid,profile) {
 const env=import.meta.env||{};
 const pilot=env.VITE_FI_ADMIN_ENABLED!=='true'&&env.VITE_FI_PILOT_ENABLED==='true';
 if(!pilot&&env.VITE_FI_ADMIN_ENABLED!=='true')return 'disabled';
 if(pilot&&profile.role!=='administrador_app'&&profile.permissions?.admin!==true)return 'excluded';
 try{
  const {fiControlRequest}=await import('./fi-control-client.js');
  const value=await fiControlRequest('service.status',{},uid,{pilot,signal:AbortSignal.timeout(15000)});
  return value?.station==='FI'?'ready':'pending';
 }catch(error){return error?.code==='FI_FORBIDDEN'?'excluded':'pending';}
}

export async function confirmEcosystemAccessUpdate({uid,deviceId,profile,request,startup,isCurrent,document:doc,storage,signOut}) {
 if(!googleProjectAuthEnabled||request.minimumRelease<recoveryReleaseFloor)return true;
 const key='sahmt-access-update-20261126:'+uid+':'+deviceId;
 try{if(storage?.getItem(key)==='verified')return true;}catch{}
 if(!startup||!isCurrent())return false;
 const [runtime,operational,{auth}]=await Promise.all([
  import('./google-project-auth-runtime.js'),import('./operational-module-firebase.js'),import('./firebase-auth.js')
 ]);
 const user=auth.currentUser;
 const current=()=>isCurrent()&&auth.currentUser===user&&user?.uid===uid;
 if(!current())return false;
 const verify=async(google,previous={})=>{
  if(!current())return null;
  const primary=await runtime.verifyGoogleProjectSession('FA');
  if(!current()||!primary)return ecosystemAccessStatuses(google,previous,false);
  const direct=await Promise.all(googleStations.filter(station=>station!=='FA').map(async station=>{
   const result=google?.targets?.[station];
   if(result?.status!=='ready')return [station,result];
   try{
    const instance=runtime.getGoogleProjectAuth(station),targetUser=instance.currentUser;
    if(targetUser?.uid!==uid)return [station,{status:'pending'}];
    const fresh=await withinDeadline(()=>targetUser.getIdToken(true),{timeoutMs:12000});
    const valid=fresh&&current()&&instance.currentUser===targetUser&&await runtime.verifyGoogleProjectSession(station);
    return [station,valid?result:{status:'pending'}];
   }catch{return [station,{status:'pending'}];}
  }));
  const refreshed={targets:Object.fromEntries(direct)};
  if(!current())return null;
  const operationalStatus={...previous};
  // Older phones and the operational brokers receive one exchange at a time.
  for(const station of operationalStations){
   if(!current())return null;
   if(operationalStatus[station]&&operationalStatus[station]!=='pending')continue;
   operationalStatus[station]=station==='FI'?await checkFi(uid,profile):
    await operational.checkOperationalModuleAccess(station,uid,current);
  }
  return current()?ecosystemAccessStatuses(refreshed,operationalStatus,true):null;
 };
 const verified=()=>{try{storage?.setItem(key,'verified');}catch{}return true;};
 const {createGoogleProjectAuthGoogleButton}=await import('./google-project-auth-google-button.js');
 if(!current())return false;
 return new Promise(resolve=>{
  const dialog=doc.createElement('dialog');
  dialog.className='required-app-update ecosystem-access-update';
  dialog.setAttribute('aria-labelledby','ecosystem-access-title');
  dialog.innerHTML='<h2 id="ecosystem-access-title">Atualização dos acessos SAHMT</h2><p>Confirme a conta Google já aberta em FA para reconectar este aparelho de FB a FK.</p><ul data-access-status></ul><p role="status" data-access-message></p><div data-access-google></div><button class="primary-button" type="button" data-access-retry>VERIFICAR NOVAMENTE</button><button class="secondary-button" type="button" data-access-signout>SAIR DA CONTA</button>';
  const list=dialog.querySelector('[data-access-status]'),message=dialog.querySelector('[data-access-message]');
  const googleHost=dialog.querySelector('[data-access-google]'),retry=dialog.querySelector('[data-access-retry]');
  let state=ecosystemAccessStatuses(null,{},false),googleConfirmed=false,busy=false,widget=null,closed=false;
  let unsubscribe=()=>{};
  function finish(ok){
   if(closed)return;
   closed=true;widget?.dispose();unsubscribe();dialog.close();dialog.remove();
   resolve(ok&&verified());
  }
  function paint(){
   list.replaceChildren(...ecosystemStations.map(station=>{
    const row=doc.createElement('li');row.textContent=station+' · '+statusLabel[state.statuses[station]];return row;
   }));
   googleHost.hidden=googleConfirmed&&!state.needsGoogle;
   retry.disabled=busy;
   if(!googleHost.hidden&&!widget){
    try{
     widget=createGoogleProjectAuthGoogleButton({
      clientId:runtime.googleProjectClientId,getExpectedIdentity:runtime.currentGoogleProjectIdentity,
      onCredential:credential=>run(()=>runtime.confirmGoogleProjectAccess(credential)),
      onError:()=>{message.textContent='Confirme a mesma conta Google usada no SAHMT.';}
     });
     void widget.render(googleHost).catch(()=>{widget?.dispose();widget=null;message.textContent='Não foi possível abrir o Google neste momento.';});
    }catch{message.textContent='Não foi possível preparar a confirmação Google.';}
   }
  }
  async function run(connect){
   if(busy||closed)return;
   if(!current()){finish(false);return;}
   busy=true;retry.disabled=true;message.textContent='Verificando os acessos…';
   try{
    const google=connect?await connect():googleConfirmed?await runtime.reconcileGoogleProjectSessions(user):null;
    if(!google){message.textContent='Confirme sua conta pelo botão do Google.';return;}
    if(connect)googleConfirmed=true;
    const updated=await verify(google,state.statuses);
    if(!updated||!current()){finish(false);return;}
    state=updated;
    if(state.complete){finish(true);return;}
    message.textContent='Aparelho ainda pendente. Confira os módulos indicados e tente novamente.';
   }catch{message.textContent='Não foi possível validar os acessos. Tente novamente.';}
   finally{busy=false;if(!closed)paint();}
  }
  retry.onclick=()=>void run();
  dialog.querySelector('[data-access-signout]').onclick=async()=>{
   try{await signOut();if(!current())finish(false);}
   catch{message.textContent='Não foi possível sair da conta agora.';}
  };
  dialog.addEventListener('cancel',event=>event.preventDefault());
  dialog.addEventListener('close',()=>finish(false));
  doc.body.append(dialog);dialog.showModal();paint();
  unsubscribe=runtime.googleProjectAuth.subscribe(()=>{if(!current())queueMicrotask(()=>finish(false));});
 });
}
