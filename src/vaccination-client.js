import {deployment} from './deployment-context.js';
const base='https://sahmt-html-training.anestesiahmtforms.workers.dev';
const messages={VAC_VERSION_CONFLICT:'Este cadastro foi alterado em outra sessão. Recarregue o período antes de salvar.',VAC_FORBIDDEN:'Seu acesso não está liberado para esta operação.',DOCUMENT_FORBIDDEN:'Seu acesso não está liberado para esta operação.',DOCUMENT_DRIVE_NOT_CONNECTED:'O envio de comprovantes ainda não foi conectado ao Drive. O cadastro pode ser salvo.',DOCUMENT_FOLDER_NOT_CONFIGURED:'Sua pasta de comprovantes ainda não foi configurada. Procure o administrador.',DOCUMENT_UPLOAD_CONFLICT:'Esta tentativa já foi usada para outro arquivo. Selecione o comprovante novamente.',DOCUMENT_UPLOAD_LIMIT:'O limite diário de envio foi atingido. Procure o administrador.',DOCUMENT_FILE_TOO_LARGE:'O arquivo ultrapassou o tamanho permitido.',DOCUMENT_IMAGE_DIMENSIONS_INVALID:'A foto não está no formato preparado pelo app. Selecione-a novamente.'};
export async function createVaccinationClient(user){
 if(deployment.target!=='FB'||deployment.projectId!=='sahmt-gestao-5ae66')throw Error('O histórico vacinal está disponível no ambiente de Gestão.');
 const [{auth},{onAuthStateChanged}]=await Promise.all([import('./firebase-auth.js'),import('firebase/auth')]);
 const valid=()=>auth?.currentUser?.uid===user.uid&&auth.app?.options?.projectId==='sahmt-gestao-5ae66';
 const pending=new Set();
 const api=async(path,action,input)=>{
  if(!valid())throw Error('Sua sessão mudou. Entre novamente.');
  const token=await auth.currentUser.getIdToken();if(!valid())throw Error('Sua sessão mudou. Entre novamente.');
  const controller=new AbortController();pending.add(controller);const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,input}),credentials:'omit',cache:'no-store',signal:controller.signal});
   if(!valid())throw Error('Sua sessão mudou. Entre novamente.');const data=await r.json();
   if(!r.ok)throw Object.assign(Error(messages[data.code]||(r.status===401?'Entre novamente para continuar.':r.status===503?'O serviço está indisponível. Tente novamente em instantes.':'Não foi possível concluir a operação. Confira os dados e tente novamente.')),{code:data.code,status:r.status});
   return data;
  }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('Não foi possível confirmar a operação. Confira sua conexão e tente novamente.');throw e;}
  finally{clearTimeout(timer);pending.delete(controller);}
 };
 return{valid,api:(action,input)=>api('/v1/vaccination',action,input),documents:(action,input)=>api('/v1/professional-documents',action,input),subscribeInvalidated:fn=>onAuthStateChanged(auth,()=>{if(!valid()){for(const c of pending)c.abort();fn();}}),dispose(){for(const c of pending)c.abort();pending.clear();}};
}
