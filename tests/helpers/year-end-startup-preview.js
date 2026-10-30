import {createServer} from 'vite';
import {validateYearEndChoices} from '../../src/year-end-schedule.js';
import {emptyYearEndTotals,changeYearEndTotals} from '../../src/year-end-schedule-totals.js';

export async function createYearEndStartupPreview(){
 const base='/SAHMT-V2.0.github.io/',records=new Map(),held=[];
 let hold=true,failSave=true;
 const stubs={
  'firebase-app.js':'export const firebaseConfigured=true,app=null,appCheckReady=Promise.resolve(null);',
  'auth.js':`const uid=new URL(location.href).searchParams.get('account')||'team';
   const user={uid,email:uid+'@example.invalid',emailVerified:true,displayName:'Pessoa de conferência',providerData:[{providerId:'google.com'}]};
   export function watchSession(fn){fn({status:'signed-in',user,offline:false,profile:{uid,email:user.email,displayName:user.displayName,active:true,access:true,role:uid==='resident'?'residente':uid==='substitute'?'substituto':'anestesiologista',permissions:{scheduleRead:true}}});return()=>{};}
   export async function retryAuthenticatedProfile(){}export async function signInGoogle(){}export async function signOutGlobal(){return true;}`,
  'data-lite.js':'export async function readAppFeatures(){return {};}export async function readSchedule(){return null;}export async function listActiveContacts(){return [];}export async function listVacationsForDate(){return [];}',
  'data.js':'export async function syncQueuedOperations(){return {};}export async function listUnsentChecklistTransfers(){return [];}export async function flushOperationalSheetDelivery(){}export async function listModuleRecords(){return [];}export async function getAppFeatures(){return {};}',
  'google-project-auth-runtime.js':'export async function maintainGoogleProjectSessions(){return {status:"ready"};}',
  'year-end-schedule-firebase.js':`export async function openYearEndScheduleRepository({uid,isCurrent,participantOnly}){
   if(participantOnly!==true)throw Error('PREVIEW_PARTICIPANT_ONLY_REQUIRED');
   const api=async(action,input)=>{if(!isCurrent())throw Error('YEAR_END_SESSION_CHANGED');const r=await fetch('${base}__year-end-fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,action,input})});const result=await r.json();if(!r.ok)throw Object.assign(Error(result.code),{code:result.code});if(!isCurrent())throw Error('YEAR_END_SESSION_CHANGED');return result;};
   return {uid,open:()=>api('open'),readOwn:()=>api('read'),subscribe(callback,onError){let active=true;Promise.all([api('read'),api('totals')]).then(([own,totals])=>{if(active)callback({own,totals,fromCache:false});},e=>{if(active)onError(e);});return()=>{active=false;};},save:input=>api('save',input)};
  }`
 };
 const plugin={name:'year-end-startup-preview',enforce:'pre',load(id){const match=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(match&&stubs[match[1]])return stubs[match[1]];},configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const path=req.url?.split('?')[0];
  if(path===base+'tests/year-end-startup.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="'+base+'src/main.js"></script></html>');return;}
  if(path!==base+'__year-end-fixture')return next();
  res.setHeader('Content-Type','application/json');
  try{
   let body='';for await(const chunk of req){body+=chunk;if(body.length>2000)throw Error('TOO_LARGE');}const {uid,action,input}=JSON.parse(body);
   const participation={sigla:uid==='shift-only'?'FR':'AB',requireGroup:uid!=='shift-only',canParticipate:true,isAdmin:false};
   if(!['team','shift-only'].includes(uid))throw Object.assign(Error('YEAR_END_INELIGIBLE'),{code:'YEAR_END_INELIGIBLE'});
   let value;
   if(action==='open')value=participation;
   else if(action==='read'){if(hold)await new Promise(resolve=>held.push(resolve));value=records.get(uid)||null;}
   else if(action==='totals')value=[...records.values()].reduce((totals,row)=>changeYearEndTotals(totals,null,row),emptyYearEndTotals());
   else if(action==='save'){
    const choices=validateYearEndChoices(input,participation);
    if(failSave){failSave=false;throw Object.assign(Error('unavailable'),{code:'unavailable'});}
    const prior=records.get(uid);value={uid,...choices,sigla:participation.sigla,position:prior?.position||records.size+1,createdAt:prior?.createdAt||Date.now(),updated:Boolean(prior)};records.set(uid,value);
   }else throw Error('UNKNOWN_ACTION');
   res.end(JSON.stringify(value));
  }catch(error){res.statusCode=400;res.end(JSON.stringify({code:error.code||error.message}));}
 });}};
 const server=await createServer({configFile:false,base,cacheDir:'.local-preview/vite-year-end-startup',optimizeDeps:{noDiscovery:true,entries:[]},
  define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FA',externalManagementEnabled:false}),'import.meta.env.VITE_GOOGLE_PROJECT_AUTH_ENABLED':JSON.stringify('false')},plugins:[plugin],server:{host:'127.0.0.1',port:0,strictPort:false}});
 const release=()=>{hold=false;for(const resolve of held.splice(0))resolve();};
 try{await server.listen();}catch(error){release();await server.close();throw error;}
 return {server,records,release,url:`http://127.0.0.1:${server.httpServer.address().port}${base}tests/year-end-startup.html`,async close(){release();await server.close();}};
}
