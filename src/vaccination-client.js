import {deployment} from './deployment-context.js';

const feEndpoint='https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev/v1/biosafety';
const manualEndpoint='https://sahmt-html-training.anestesiahmtforms.workers.dev/v1/biosafety-manual';
const messages={MANUAL_FORBIDDEN:'Seu acesso ao manual não está liberado.',MANUAL_NOT_FOUND:'O manual está temporariamente indisponível.',DOSIMETRY_FORBIDDEN:'Seu acesso ao histórico individual não está liberado.',DOSIMETRY_RECORD_UNAVAILABLE:'Seu relatório precisa ser conferido pelo administrador. Tente novamente após a revisão.',VAC_CATEGORY_NOT_CONFIGURED:'Seu vínculo profissional precisa ser revisado pelo administrador antes de salvar.',VAC_VERSION_CONFLICT:'Este cadastro foi alterado em outra sessão. Recarregue o período antes de salvar.',VAC_FORBIDDEN:'Seu acesso não está liberado para esta operação.',DOCUMENT_FORBIDDEN:'Seu acesso não está liberado para esta operação.',DOCUMENT_DRIVE_NOT_CONNECTED:'O envio de comprovantes ainda não foi conectado ao Drive. O cadastro pode ser salvo.',DOCUMENT_FOLDER_NOT_CONFIGURED:'Sua pasta de comprovantes ainda não foi configurada. Procure o administrador.',DOCUMENT_UPLOAD_CONFLICT:'Esta tentativa já foi usada para outro arquivo. Selecione o comprovante novamente.',DOCUMENT_UPLOAD_LIMIT:'O limite diário de envio foi atingido. Procure o administrador.',DOCUMENT_FILE_TOO_LARGE:'O arquivo ultrapassou o tamanho permitido.',DOCUMENT_IMAGE_DIMENSIONS_INVALID:'A foto não está no formato preparado pelo app. Selecione-a novamente.'};
export async function createVaccinationClient(user,{isCurrent=()=>true,auth}={}){
 const session=auth||(await import('./firebase-auth.js')).auth;
 await session?.authStateReady();
 return createClient(user,session,'sahmt-17a16',isCurrent,(kind,action,payload)=>({
  url:feEndpoint,body:{action,input:{kind,payload}}
 }));
}

export async function createBiosafetyManualClient(user){
 if(deployment.target!=='FB'||deployment.projectId!=='sahmt-gestao-5ae66')throw Error('O manual está disponível em Gestão de Pessoas.');
 const {auth}=await import('./firebase-auth.js');
 return createClient(user,auth,'sahmt-gestao-5ae66',()=>true,(_kind,action,input)=>({
  url:manualEndpoint,body:{action,input}
 }));
}

export async function createFunctionalOccupationalReader(user,{isCurrent,auth}){
 const client=await createVaccinationClient(user,{isCurrent,auth});
 return {
  async read(source,year){
   if(source==='vaccination')return client.api('BOOTSTRAP',{year});

   throw Error('FK_SOURCE_INVALID');
  },
  dispose:client.dispose
 };
}

async function createClient(user,auth,project,isCurrent,request){
 const {onAuthStateChanged}=await import('firebase/auth');
 const actor=auth?.currentUser;
 const valid=()=>isCurrent()&&Boolean(user?.uid)&&actor?.uid===user.uid&&auth.currentUser===actor&&auth.app?.options?.projectId===project;
 const pending=new Set();
 const api=async(kind,action,input)=>{
  if(!valid())throw Error('Sua sessão mudou. Entre novamente.');
  const token=await actor.getIdToken();if(!valid())throw Error('Sua sessão mudou. Entre novamente.');
  const controller=new AbortController();pending.add(controller);const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const {url,body}=request(kind,action,input);
   const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
   if(!valid())throw Error('Sua sessão mudou. Entre novamente.');const data=await r.json();
   if(!r.ok)throw Object.assign(Error(messages[data.code]||(r.status===401?'Entre novamente para continuar.':r.status===503?'O serviço está indisponível. Tente novamente em instantes.':'Não foi possível concluir a operação. Confira os dados e tente novamente.')),{code:data.code,status:r.status});
   return data;
  }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('Não foi possível confirmar a operação. Confira sua conexão e tente novamente.');throw e;}
  finally{clearTimeout(timer);pending.delete(controller);}
 };
 return {valid,manual:(action,input)=>api('manual',action,input),dosimetry:(action,input)=>api('dosimetry',action,input),
  api:(action,input)=>api('vaccination',action,input),documents:(action,input)=>api('documents',action,input),
  subscribeInvalidated:fn=>onAuthStateChanged(auth,()=>{if(!valid()){for(const c of pending)c.abort();fn();}}),
  dispose(){for(const c of pending)c.abort();pending.clear();}};
}
